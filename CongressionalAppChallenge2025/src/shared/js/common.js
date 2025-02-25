function initCommon() {
    console.log('Common functionality initialized');
}

if (!window.platform) {
    window.platform = {
        isDesktop: typeof window.versions !== 'undefined',
        isMobile: typeof window.cordova !== 'undefined'
    };
}

window.initCommon = initCommon