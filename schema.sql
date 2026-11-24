-- =============================================================================
-- University Residence Portal - Hardened Production Database Schema
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Core Users Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    birth_date VARCHAR(64),
    birth_year INT CHECK (birth_year IS NULL OR (birth_year >= 1900 AND birth_year <= 2100)),
    phone VARCHAR(64),
    instagram VARCHAR(128),
    linkedin VARCHAR(255),
    token_version INT NOT NULL DEFAULT 1,
    
    -- Residence & College Metadata
    residence VARCHAR(64) NOT NULL CHECK (residence IN ('Residence_name_1', 'Residence_name_2', 'Residence_name_3')),
    floor VARCHAR(64) CHECK (floor IS NULL OR floor IN ('0th floor', '1st floor','2nd floor','3rd floor','4th floor','5th floor')),
    room VARCHAR(64) CHECK (room IS NULL OR room ~ '^[0-9]+$'),
    first_year_in_college INT NOT NULL CHECK (first_year_in_college >= 1935),
    first_month_in_college INT NOT NULL DEFAULT 1 CHECK (first_month_in_college BETWEEN 1 AND 12),
    is_currently_in_college BOOLEAN NOT NULL DEFAULT TRUE,
    departure_year INT CHECK (departure_year IS NULL OR departure_year >= 1935),
    departure_month INT CHECK (departure_month IS NULL OR departure_month BETWEEN 1 AND 12),

    -- Academic Profile
    course VARCHAR(255) NOT NULL,
    academic_year VARCHAR(64) NOT NULL DEFAULT '1st Year',
    study_level VARCHAR(64) NOT NULL DEFAULT 'BSc' CHECK (study_level IN ('BSc', 'MSc (Magistrale)', 'PhD')),
    
    -- Geographical Coordinates & Placement
    origin_continent VARCHAR(64) NOT NULL DEFAULT 'Europe',
    origin_country VARCHAR(128) NOT NULL DEFAULT 'Italy',
    origin_region VARCHAR(128) NOT NULL DEFAULT 'Piemonte',
    origin_city VARCHAR(128) NOT NULL DEFAULT '',
    coords NUMERIC(9,6)[] DEFAULT ARRAY[45.0683, 7.6831],

    -- Authorization & State
    status VARCHAR(64) NOT NULL DEFAULT 'Pending Verification',
    role VARCHAR(32) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin', 'superadmin')),
    tags TEXT[] NOT NULL DEFAULT ARRAY['Current Resident']::TEXT[],
    avatar TEXT,
    story TEXT,
    photos JSONB NOT NULL DEFAULT '[]'::JSONB,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    endorsements TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    has_seen_welcome BOOLEAN NOT NULL DEFAULT FALSE,
    bacheca JSONB NOT NULL DEFAULT '[]'::JSONB,
    residency_history JSONB NOT NULL DEFAULT '[]'::JSONB,
    privacy JSONB NOT NULL DEFAULT '{"firstName":"public","lastName":"public","residence":"public","floorRoom":"public","story":"public","bacheca":"public","residencyHistory":"public"}'::JSONB,
    is_founder BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_month_in_college INT NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS departure_month INT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_departure_month_check;
ALTER TABLE users ADD CONSTRAINT users_departure_month_check CHECK (departure_month IS NULL OR departure_month BETWEEN 1 AND 12);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_first_month_in_college_check;
ALTER TABLE users ADD CONSTRAINT users_first_month_in_college_check CHECK (first_month_in_college BETWEEN 1 AND 12);

-- Backfill the primary/last residence stay so residence history is immediately
-- available even for accounts created before the history editor existed.
UPDATE users
SET residency_history = jsonb_build_array(
    jsonb_build_object(
        'startDate', first_year_in_college::text || '-' || LPAD(first_month_in_college::text, 2, '0'),
        'endDate',
          CASE
            WHEN is_currently_in_college THEN NULL
            ELSE departure_year::text || '-' || LPAD(COALESCE(departure_month, 12)::text, 2, '0')
          END,
        'section', residence,
        'floor', floor,
        'room', room
    )
)
WHERE COALESCE(jsonb_array_length(residency_history), 0) = 0
  AND residence IS NOT NULL
  AND floor IS NOT NULL
  AND room IS NOT NULL;

-- Residence history is part of the public historical profile.
UPDATE users
SET privacy = jsonb_set(COALESCE(privacy, '{}'::jsonb), '{residencyHistory}', '"public"'::jsonb)
WHERE NOT (COALESCE(privacy, '{}'::jsonb) ? 'residencyHistory');

-- =============================================================================
-- System Settings Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Forensic Audit Logs
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255),
    user_role VARCHAR(32),
    action VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NOT NULL,
    previous_state JSONB,
    new_state JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Email OTP Verifications
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_verifications (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(64) NOT NULL,
    purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('registration', 'reset_password', 'login_2fa')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0
);

-- =============================================================================
-- Notifications Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) PRIMARY KEY,
    recipient_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    recipient_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    recipient_scope VARCHAR(32) NOT NULL CHECK (recipient_scope IN ('individual', 'group', 'all', 'admin', 'section', 'role')),
    sender_id VARCHAR(64) NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'accepted', 'declined')),
    read_by_user_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    requested_channels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    target_student_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
    resource_type VARCHAR(64),
    resource_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Executive Administrative Chat
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_chat (
    id VARCHAR(64) PRIMARY KEY,
    sender_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_name VARCHAR(255) NOT NULL,
    sender_role VARCHAR(32) NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Resident Suggestions Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS suggestions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    user_residence VARCHAR(128),
    text TEXT NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'Received',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Community Feature Tables
-- =============================================================================

-- Virtual Study Rooms
CREATE TABLE IF NOT EXISTS study_rooms (
    id VARCHAR(64) PRIMARY KEY,
    creator_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    meeting_link TEXT,
    cloud_link TEXT,
    chat_link TEXT,
    members JSONB NOT NULL DEFAULT '[]'::JSONB,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Annual Time Capsule
CREATE TABLE IF NOT EXISTS time_capsules (
    id VARCHAR(64) PRIMARY KEY,
    academic_year VARCHAR(16) NOT NULL,
    section VARCHAR(64) NOT NULL CHECK (section IN ('Residence_name_1','Residence_name_2','Residence_name_3',)),
    seal_date DATE NOT NULL DEFAULT CURRENT_DATE,
    unlock_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_sealed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_section_academic_year UNIQUE (academic_year, section)
);

CREATE TABLE IF NOT EXISTS time_capsule_entries (
    id VARCHAR(64) PRIMARY KEY,
    capsule_id VARCHAR(64) NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
    author_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    author_name VARCHAR(255) NOT NULL,
    section VARCHAR(64) NOT NULL,
    entry_type VARCHAR(32) NOT NULL CHECK (entry_type IN ('quote', 'text', 'photo')),
    content TEXT NOT NULL,
    photo_url TEXT,
    confirmed_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Academic Exchanges & World Map
CREATE TABLE IF NOT EXISTS academic_exchanges (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    user_name VARCHAR(255) NOT NULL,
    university_name VARCHAR(255) NOT NULL,
    city VARCHAR(128) NOT NULL,
    country VARCHAR(128) NOT NULL,
    program_type VARCHAR(64) NOT NULL,
    academics_rating INT NOT NULL CHECK (academics_rating BETWEEN 1 AND 5),
    cost_of_living_rating INT NOT NULL CHECK (cost_of_living_rating BETWEEN 1 AND 5),
    housing_rating INT NOT NULL CHECK (housing_rating BETWEEN 1 AND 5),
    neighborhood_advice TEXT,
    coords NUMERIC(9,6)[] NOT NULL DEFAULT ARRAY[45.0683, 7.6831],
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Social Kitchen Recipes
CREATE TABLE IF NOT EXISTS recipes (
    id VARCHAR(64) PRIMARY KEY,
    author_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    author_name VARCHAR(255) NOT NULL,
    residence VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    regional_origin VARCHAR(128) NOT NULL,
    ingredients TEXT NOT NULL,
    steps TEXT NOT NULL,
    image_url TEXT NOT NULL,
    ratings JSONB NOT NULL DEFAULT '{}'::JSONB,
    average_rating NUMERIC(3,2) NOT NULL DEFAULT 0.00,
    total_votes INT NOT NULL DEFAULT 0,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Jukebox Tracks
CREATE TABLE IF NOT EXISTS jukebox_tracks (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    user_name VARCHAR(255) NOT NULL,
    residence VARCHAR(64) NOT NULL,
    spotify_url TEXT NOT NULL,
    spotify_track_id VARCHAR(128) NOT NULL,
    track_title VARCHAR(255) NOT NULL,
    track_artist VARCHAR(255) NOT NULL,
    likes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Match Finder Events
CREATE TABLE IF NOT EXISTS match_finder_events (
    id VARCHAR(64) PRIMARY KEY,
    creator_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    creator_name VARCHAR(255) NOT NULL,
    creator_contact VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    event_date TIMESTAMP WITH TIME ZONE NOT NULL,
    location VARCHAR(255) NOT NULL,
    missing_players INT NOT NULL CHECK (missing_players >= 0),
    participants JSONB NOT NULL DEFAULT '[]'::JSONB,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- City Survival Guide Places
CREATE TABLE IF NOT EXISTS city_guide_places (
    id VARCHAR(64) PRIMARY KEY,
    author_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    author_name VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    address TEXT NOT NULL,
    practical_advice TEXT NOT NULL,
    nearest_sections TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ratings JSONB NOT NULL DEFAULT '{}'::JSONB,
    average_rating NUMERIC(3,2) NOT NULL DEFAULT 0.00,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- City Survival Guide Reviews (one review per user/place, with immutable creation date)
CREATE TABLE IF NOT EXISTS city_guide_reviews (
    id VARCHAR(64) PRIMARY KEY,
    place_id VARCHAR(64) NOT NULL REFERENCES city_guide_places(id) ON DELETE CASCADE,
    author_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(255) NOT NULL,
    review TEXT NOT NULL,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_city_guide_review_author UNIQUE (place_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_city_guide_reviews_place_created
    ON city_guide_reviews (place_id, created_at DESC);

-- Backfill the legacy single advice field as the first review for each place.
INSERT INTO city_guide_reviews (id, place_id, author_id, author_name, review, created_at, updated_at)
SELECT 'guide-review-' || p.id,
       p.id,
       p.author_id,
       p.author_name,
       p.practical_advice,
       p.created_at,
       p.created_at
FROM city_guide_places p
WHERE NULLIF(BTRIM(p.practical_advice), '') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM city_guide_reviews r
      WHERE r.id = 'guide-review-' || p.id
  );

-- Language Tandems
CREATE TABLE IF NOT EXISTS language_tandems (
    id VARCHAR(64) PRIMARY KEY,
    creator_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    creator_name VARCHAR(255) NOT NULL,
    native_language VARCHAR(64) NOT NULL,
    target_language VARCHAR(64) NOT NULL,
    declared_level VARCHAR(32) NOT NULL CHECK (declared_level IN ('Native', 'Intermediate', 'Beginner')),
    meeting_preference TEXT,
    members JSONB NOT NULL DEFAULT '[]'::JSONB,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Passion Clubs
CREATE TABLE IF NOT EXISTS passion_clubs (
    id VARCHAR(64) PRIMARY KEY,
    creator_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    resources JSONB NOT NULL DEFAULT '[]'::JSONB,
    events JSONB NOT NULL DEFAULT '[]'::JSONB,
    members JSONB NOT NULL DEFAULT '[]'::JSONB,
    meeting_link TEXT,
    chat_link TEXT,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Book & Notes Marketplace
CREATE TABLE IF NOT EXISTS book_marketplace (
    id VARCHAR(64) PRIMARY KEY,
    seller_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    seller_name VARCHAR(255) NOT NULL,
    seller_section VARCHAR(64) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    price_tag VARCHAR(64) NOT NULL,
    wear_condition VARCHAR(64) NOT NULL,
    cover_image_url TEXT,
    is_sold BOOLEAN NOT NULL DEFAULT FALSE,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- End-of-Year Freebox
CREATE TABLE IF NOT EXISTS freebox_items (
    id VARCHAR(64) PRIMARY KEY,
    donor_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    donor_name VARCHAR(255) NOT NULL,
    donor_section VARCHAR(64) NOT NULL,
    donor_floor_room VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    photo_url TEXT,
    is_claimed BOOLEAN NOT NULL DEFAULT FALSE,
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Community Startups
CREATE TABLE IF NOT EXISTS community_startups (
    id VARCHAR(64) PRIMARY KEY,
    founder_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    founder_name VARCHAR(255) NOT NULL,
    founder_section VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    industry VARCHAR(64) NOT NULL,
    stage VARCHAR(64) NOT NULL,
    elevator_pitch VARCHAR(400) NOT NULL,
    needed_roles TEXT[] NOT NULL,
    commitment_type VARCHAR(64) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'Open for Collaborators',
    reports_count INT NOT NULL DEFAULT 0,
    reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Startup Applications
CREATE TABLE IF NOT EXISTS startup_applications (
    id VARCHAR(64) PRIMARY KEY,
    startup_id VARCHAR(64) NOT NULL REFERENCES community_startups(id) ON DELETE CASCADE,
    applicant_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    applicant_name VARCHAR(255) NOT NULL,
    applicant_email VARCHAR(255) NOT NULL,
    applicant_contact VARCHAR(255) NOT NULL,
    role_competence VARCHAR(255) NOT NULL,
    portfolio_link TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Existing installations may already have the original 6-character OTP column.
-- Widen it before the application stores HMAC-SHA256 OTP digests (64 hex chars).
ALTER TABLE email_verifications
  ALTER COLUMN code TYPE VARCHAR(64);

ALTER TABLE jukebox_tracks ADD COLUMN IF NOT EXISTS reports_count INT NOT NULL DEFAULT 0;
ALTER TABLE jukebox_tracks ADD COLUMN IF NOT EXISTS reported_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE jukebox_tracks ADD COLUMN IF NOT EXISTS admin_removals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- =============================================================================
-- Indexes for Query Performance & Lookups
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(TRIM(email)));
CREATE INDEX IF NOT EXISTS idx_users_residence ON users (residence);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_verified_hidden ON users (verified, is_hidden);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_scope ON notifications (recipient_scope);
CREATE INDEX IF NOT EXISTS idx_notifications_resource ON notifications (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_email_verif_lookup ON email_verifications (email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_lookup ON audit_logs (user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_events_date ON match_finder_events (event_date) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_marketplace_active ON book_marketplace (is_sold, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_freebox_active ON freebox_items (is_claimed, created_at DESC);
-- A song may be shared by different residents, but one resident cannot
-- occupy two personal slots with the same exact track.
DELETE FROM jukebox_tracks a
USING jukebox_tracks b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.spotify_track_id = b.spotify_track_id
  AND a.spotify_track_id <> ''
  AND a.track_title <> 'Spotify Track'
  AND a.track_artist <> 'Artist';

DROP INDEX IF EXISTS uq_jukebox_title_artist;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jukebox_user_track
  ON jukebox_tracks (user_id, spotify_track_id)
  WHERE spotify_track_id <> '';

-- =============================================================================
-- Default System Settings Seed
-- =============================================================================
INSERT INTO system_settings (key, value) 
VALUES 
('welcomeMessage', E'Despite an infinite world of different choices, timing, and directions,\nyet, we still met.\nWelcome to the University Residence Portal.\nLeave your story, leave your trace.'),

('concernLetter', 'Dear residents and friends,

This is a sample introductory letter. Administrators can replace it from the admin panel with their own message.

Use this space to explain what the portal is for, how new members are welcomed through peer endorsement, and what you hope the community will build together: a living archive of memories, stories and people.

Welcome aboard.
')

ON CONFLICT (key) DO NOTHING;

-- Migrate the previous default welcome copy without overwriting a customized admin message.
UPDATE system_settings
SET value = E'Despite an infinite world of different choices, timing, and directions, yet, we still met.\n\nWelcome to the University Residence Portal.\n\nLeave your story, leave your trace.'
WHERE key = 'welcomeMessage'
  AND value = 'Despite an infinite world of different choices, timing, and directions, yet, we still met. Welcome to the University Residence Portal. Leave your story, leave your trace.';


-- =============================================================================
-- Automated Maintenance Procedure: Expired OTP Cleanup
-- =============================================================================
CREATE OR REPLACE FUNCTION purge_expired_email_verifications()
RETURNS void AS $$
BEGIN
    DELETE FROM email_verifications WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Prevent duplicate applications by the same resident to the same startup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_applicant ON startup_applications(startup_id, applicant_id);

-- =============================================================================
-- Backward-compatible security/data migration for databases created by older releases
-- =============================================================================
ALTER TABLE users DROP COLUMN IF EXISTS doc_verified;
ALTER TABLE users DROP COLUMN IF EXISTS mrz_attempts;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_floor_check;
-- Must accept every value of ALLOWED_FLOORS (src/utils/validation.js); the old
-- list rejected '0 floor' and 'Fabbricato' with a 500 at registration. Legacy
-- spellings stay allowed so existing rows do not block the migration.
ALTER TABLE users ADD CONSTRAINT users_floor_check CHECK (floor IS NULL OR floor IN (
  '0 floor','1st floor','2nd floor','3rd floor','4th floor','5th floor',
  '0th floor'
));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_room_check;
ALTER TABLE users ADD CONSTRAINT users_room_check CHECK (room IS NULL OR room ~ '^[0-9]+$');

-- =============================================================================
-- TABLE TO SAVE CONTACTS 
-- =============================================================================
CREATE TABLE IF NOT EXISTS contact_shares (
    viewer_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id  VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channels  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (viewer_id, owner_id)
);

-- ==============================================================================
-- TABLE FOR ROOMS ACCESS NOTIFICATIONS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS join_requests (
    id VARCHAR(64) PRIMARY KEY,
    target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('study_room', 'passion_club')),
    target_id VARCHAR(64) NOT NULL,
    requester_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester_name VARCHAR(255) NOT NULL,
    chosen_contact TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_join_requests_pending
    ON join_requests(target_type, target_id, requester_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_join_requests_requester ON join_requests(requester_id, status);
