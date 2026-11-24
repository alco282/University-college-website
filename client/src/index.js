import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';


class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorId: null };
  }

  static getDerivedStateFromError() {
    return { 
      hasError: true, 
      errorId: (typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID().slice(0, 8) 
        : Math.random().toString(36).substring(2, 10)
    };
  }

  componentDidCatch(error, errorInfo) {
    // Restrict stack logging to non-production environments to avoid leaking source structure
    if (process.env.NODE_ENV !== 'production') {
      console.error('[PORTAL RENDER CRASH]:', error, errorInfo);
    }
  }

  handleReload = () => {
    window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      return (
        <div 
          role="alert" 
          aria-live="assertive"
          className="min-h-screen bg-[#F4F3EF] flex items-center justify-center p-6 text-[#1A1A1A] font-sans"
        >
          <div className="bg-white max-w-md w-full rounded-3xl p-8 border border-[#D5D3CC] shadow-xl text-center space-y-5">
            <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center mx-auto text-[#B31217]">
              <svg 
                className="w-6 h-6" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24" 
                aria-hidden="true"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth="2" 
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                />
              </svg>
            </div>

            <div>
              <h1 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-gray-900">
                Interface Rendering Failure
              </h1>
              <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                An unexpected condition prevented this view from displaying properly. 
                Your session is intact and no data was lost.
              </p>
            </div>

            {this.state.errorId && (
              <p className="text-[11px] font-mono text-gray-400 bg-gray-50 py-1.5 px-3 rounded-lg border border-gray-200 inline-block">
                Ref ID: {this.state.errorId}
              </p>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white font-bold rounded-xl text-xs uppercase tracking-wider shadow transition-all focus:outline-none focus:ring-2 focus:ring-[#B31217] focus:ring-offset-2"
              >
                Reload Digital Portal
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Critical: Root element #root was not found in the DOM.');
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);