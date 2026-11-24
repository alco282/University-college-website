import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const TurnstileInvisible = forwardRef(function TurnstileInvisible(
  { siteKey, action = 'registration', onToken, onError },
  ref
) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const activeResolverRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    if (!siteKey || typeof window === 'undefined') return undefined;

    const renderWidget = () => {
      if (!isMounted || !containerRef.current || !window.turnstile || widgetIdRef.current !== null) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          size: 'invisible',
          execution: 'execute', // Crucial: prevents auto-execution on render
          action,
          callback: (token) => {
            onToken?.(token);
            activeResolverRef.current?.(token);
            activeResolverRef.current = null;
          },
          'error-callback': () => {
            onError?.();
            activeResolverRef.current?.('');
            activeResolverRef.current = null;
          },
          'expired-callback': () => {
            onToken?.('');
            activeResolverRef.current?.('');
            activeResolverRef.current = null;
          }
        });
      } catch (err) {
        console.error('[TURNSTILE RENDER ERROR]:', err);
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', renderWidget, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener('load', renderWidget, { once: true });
        document.head.appendChild(script);
      }
    }

    return () => {
      isMounted = false;
      if (widgetIdRef.current !== null && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, action, onToken, onError]);

  useImperativeHandle(
    ref,
    () => ({
      execute: async () => {
        if (!siteKey) {
          if (process.env.NODE_ENV !== 'production') return 'dev-bypass-token';
          throw new Error('Bot protection is not configured.');
        }

        // Wait up to 4 seconds for the Turnstile script and widget to initialize
        const startTime = Date.now();
        while ((!window.turnstile || widgetIdRef.current === null) && Date.now() - startTime < 4000) {
          await new Promise((r) => setTimeout(r, 100));
        }

        if (!window.turnstile || widgetIdRef.current === null) {
          if (process.env.NODE_ENV !== 'production') return 'dev-bypass-token';
          throw new Error('Bot verification is initializing. Please retry in a moment.');
        }

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            activeResolverRef.current = null;
            if (process.env.NODE_ENV !== 'production') {
              resolve('dev-bypass-token');
            } else {
              reject(new Error('Bot verification timed out. Please retry.'));
            }
          }, 8000);

          activeResolverRef.current = (token) => {
            clearTimeout(timeout);
            resolve(token);
          };

          try {
            window.turnstile.reset(widgetIdRef.current);
            window.turnstile.execute(widgetIdRef.current);
          } catch (err) {
            clearTimeout(timeout);
            activeResolverRef.current = null;
            if (process.env.NODE_ENV !== 'production') {
              resolve('dev-bypass-token');
            } else {
              reject(err);
            }
          }
        });
      }
    }),
    [siteKey]
  );

  if (!siteKey) return null;
  return <div ref={containerRef} aria-hidden="true" className="hidden" />;
});