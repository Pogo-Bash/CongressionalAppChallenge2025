import { focusTracker } from '../../../shared/js/components/focus-tracker.js';


// Fix for versions API issue
document.addEventListener('DOMContentLoaded', () => {
  // Display version information
  const versionElements = document.querySelectorAll('.versions li');
  
  // Ensure elements exist before trying to update them
  if (versionElements.length >= 3) {
    const electronVersion = versionElements[0];
    const chromeVersion = versionElements[1];
    const nodeVersion = versionElements[2];
    
    // Check if versions API exists before trying to use it
    if (window.versions) {
      electronVersion.textContent = `Electron: ${typeof window.versions.electron === 'function' ? window.versions.electron() : 'N/A'}`;
      chromeVersion.textContent = `Chromium: ${typeof window.versions.chrome === 'function' ? window.versions.chrome() : 'N/A'}`;
      nodeVersion.textContent = `Node: ${typeof window.versions.node === 'function' ? window.versions.node() : 'N/A'}`;
    } else {
      console.warn('Versions API not available');
      electronVersion.textContent = 'Electron: N/A';
      chromeVersion.textContent = 'Chromium: N/A';
      nodeVersion.textContent = 'Node: N/A';
    }
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const focusContainer = document.getElementById('focus-tracking-container');

  if (focusContainer) {
    await focusTracker.initialize(focusContainer);
    console.log('Focus tracker initialized');
  }
});

// Navigation
document.querySelectorAll('.nav-btn').forEach(button => {
  button.addEventListener('click', () => {
    // Remove active class from all buttons and sections
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
    
    // Add active class to clicked button and corresponding section
    button.classList.add('active');
    const sectionId = button.dataset.section + '-section';
    document.getElementById(sectionId).classList.add('active');
  });
});

// Initialize focus tracking when that section is shown
document.querySelector('[data-section="focus"]').addEventListener('click', async () => {
  const focusContainer = document.getElementById('focus-tracking-container');
  
  // Import using dynamic import to avoid loading until needed
  try {
    const { focusTracker } = await import('../../../shared/js/components/focus-tracker.js');
    await focusTracker.initialize(focusContainer);
    console.log('Focus tracker initialized');
  } catch (error) {
    console.error('Error initializing focus tracker:', error);
    focusContainer.innerHTML = `
      <div class="error-message">
        <p>Error initializing focus tracking: ${error.message}</p>
        <button id="retry-focus">Retry</button>
      </div>
    `;
    
    document.getElementById('retry-focus')?.addEventListener('click', () => {
      document.querySelector('[data-section="focus"]').click();
    });
  }
});

// Google Classroom connection
document.getElementById('connect-classroom')?.addEventListener('click', () => {
  // Call your Google authentication function here
  console.log('Connecting to Google Classroom...');
});
