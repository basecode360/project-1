// Client-specific debugging and error reporting
export const clientDiagnostics = {
  // Collect comprehensive client environment info
  getClientEnvironment: () => {
    return {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      browser: {
        name: getBrowserName(),
        version: getBrowserVersion(),
        language: navigator.language,
        languages: navigator.languages,
        platform: navigator.platform,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        hardwareConcurrency: navigator.hardwareConcurrency,
      },
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
      },
      location: {
        href: window.location.href,
        origin: window.location.origin,
        protocol: window.location.protocol,
        host: window.location.host,
        hostname: window.location.hostname,
        port: window.location.port,
      },
      connection: getConnectionInfo(),
      localStorage: getLocalStorageInfo(),
      sessionStorage: getSessionStorageInfo(),
    };
  },

  // Test network connectivity with detailed timing
  testConnectivity: async (url) => {
    const startTime = performance.now();
    const result = {
      url,
      startTime: new Date().toISOString(),
      timing: {},
      error: null,
      success: false,
    };

    try {
      // Test with fetch first
      const fetchStart = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        cache: 'no-cache',
        mode: 'cors',
        credentials: 'include',
      });

      clearTimeout(timeoutId);
      const fetchEnd = performance.now();

      result.timing.fetch = fetchEnd - fetchStart;
      result.success = response.ok;
      result.status = response.status;
      result.headers = Object.fromEntries(response.headers.entries());

      if (response.ok) {
        const data = await response.json();
        result.responseData = data;
      }
    } catch (error) {
      result.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
      };
    }

    result.timing.total = performance.now() - startTime;
    return result;
  },

  // Test API endpoints specifically
  testApiEndpoints: async () => {
    const baseURL =
      import.meta.env.VITE_BACKEND_URL || 'https://17autoparts.com/api';
    const endpoints = [
      `${baseURL}/health`,
      `${baseURL}/auth`,
      `${baseURL}/diagnostics`,
    ];

    const results = [];
    for (const endpoint of endpoints) {
      console.log(`Testing endpoint: ${endpoint}`);
      const result = await clientDiagnostics.testConnectivity(endpoint);
      results.push(result);

      // Add delay between tests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return results;
  },

  // Generate comprehensive error report
  generateErrorReport: async (error, context = {}) => {
    const report = {
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
      },
      context,
      environment: clientDiagnostics.getClientEnvironment(),
      connectivity: await clientDiagnostics.testApiEndpoints(),
    };

    console.error('🚨 Comprehensive Error Report:', report);
    return report;
  },

  // Send error report to server
  sendErrorReport: async (report) => {
    try {
      const response = await fetch('/api/error-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(report),
      });

      if (response.ok) {
        console.log('✅ Error report sent successfully');
      } else {
        console.warn('⚠️ Failed to send error report:', response.status);
      }
    } catch (err) {
      console.warn('⚠️ Could not send error report:', err.message);
    }
  },
};

// Helper functions
function getBrowserName() {
  const userAgent = navigator.userAgent;
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  if (userAgent.includes('Opera')) return 'Opera';
  return 'Unknown';
}

function getBrowserVersion() {
  const userAgent = navigator.userAgent;
  const match = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)\/(\d+)/);
  return match ? match[2] : 'Unknown';
}

function getConnectionInfo() {
  if ('connection' in navigator) {
    const connection = navigator.connection;
    return {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData,
    };
  }
  return null;
}

function getLocalStorageInfo() {
  try {
    const keys = Object.keys(localStorage);
    return {
      available: true,
      itemCount: keys.length,
      keys: keys.filter((key) => !key.includes('password')), // Exclude sensitive data
      size: JSON.stringify(localStorage).length,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
    };
  }
}

function getSessionStorageInfo() {
  try {
    const keys = Object.keys(sessionStorage);
    return {
      available: true,
      itemCount: keys.length,
      keys: keys.filter((key) => !key.includes('password')), // Exclude sensitive data
      size: JSON.stringify(sessionStorage).length,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
    };
  }
}

export default clientDiagnostics;
