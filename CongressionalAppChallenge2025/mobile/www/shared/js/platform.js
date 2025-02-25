// Platform detection
(function() {
    // Detect if running in Electron
    const isElectron = window.versions && window.versions.electron ? true : false;
    
    // Detect if running in Cordova
    const isCordova = typeof window.cordova !== 'undefined';
    
    // Set global platform object
    window.platform = {
      isDesktop: isElectron,
      isMobile: isCordova
    };
    
    // Update UI based on platform
    document.addEventListener('DOMContentLoaded', function() {
      if (window.platform.isDesktop) {
        document.getElementById('desktop-indicator').style.display = 'block';
      }
      
      if (window.platform.isMobile) {
        document.getElementById('mobile-indicator').style.display = 'block';
      }
    });
    
    // Add Cordova's deviceready event listener if on mobile
    if (isCordova) {
      document.addEventListener('deviceready', onDeviceReady, false);
    } else {
      // If not on Cordova, run init on DOMContentLoaded
      document.addEventListener('DOMContentLoaded', function() {
        if (typeof onDeviceReady === 'function') {
          onDeviceReady();
        }
      });
    }
    
    function onDeviceReady() {
      console.log('Platform ready');
      // Initialize platform-specific features
    }
  })();