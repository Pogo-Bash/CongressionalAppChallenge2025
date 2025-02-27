// src/renderer/src/renderer.js
import { focusTracker } from '../../../shared/js/components/focus-tracker.js';
import { themeManager } from './theme-manager.js';

// For the chart (we'll create a simple placeholder for now)
function createFocusChart() {
  const chartElement = document.getElementById('focus-chart');
  if (!chartElement) return;
  
  // This is just a placeholder - you'll want to use a proper chart library
  const chartHTML = `
    <div class="chart-placeholder">
      <svg width="100%" height="100%" viewBox="0 0 800 300">
        <!-- Chart grid -->
        <line x1="0" y1="250" x2="800" y2="250" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="100" x2="800" y2="100" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="0" y1="50" x2="800" y2="50" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        
        <!-- Chart data - Focus level line -->
        <path d="M0,200 Q100,180 200,150 T400,100 T600,170 T800,120" fill="none" stroke="#3366ff" stroke-width="3"/>
        
        <!-- Chart data - Previous period line -->
        <path d="M0,180 Q100,200 200,220 T400,150 T600,190 T800,170" fill="none" stroke="#ff9966" stroke-width="3" stroke-dasharray="5,5"/>
        
        <!-- X-axis labels -->
        <text x="0" y="270" fill="#b0b7c3" font-size="12">Mon</text>
        <text x="133" y="270" fill="#b0b7c3" font-size="12">Tue</text>
        <text x="266" y="270" fill="#b0b7c3" font-size="12">Wed</text>
        <text x="399" y="270" fill="#b0b7c3" font-size="12">Thu</text>
        <text x="532" y="270" fill="#b0b7c3" font-size="12">Fri</text>
        <text x="665" y="270" fill="#b0b7c3" font-size="12">Sat</text>
        <text x="798" y="270" fill="#b0b7c3" font-size="12">Sun</text>
        
        <!-- Legend -->
        <circle cx="650" cy="20" r="5" fill="#3366ff"/>
        <text x="660" y="25" fill="#ffffff" font-size="12">This week</text>
        <circle cx="740" cy="20" r="5" fill="#ff9966"/>
        <text x="750" y="25" fill="#ffffff" font-size="12">Last week</text>
      </svg>
    </div>
  `;
  
  chartElement.innerHTML = chartHTML;
}

// Initialize navigation
function initNavigation() {
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
}

// Initialize settings
function initSettings() {
  // Theme options
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', () => {
      const theme = option.dataset.theme;
      document.querySelectorAll('.theme-option').forEach(btn => btn.classList.remove('active'));
      option.classList.add('active');
      themeManager.setTheme(theme);
    });
  });
  
  // Theme toggle button
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    themeManager.toggleTheme();
  });
  
  // Connect Google Classroom button
  document.getElementById('connect-classroom')?.addEventListener('click', () => {
    // Placeholder for Google Classroom integration
    console.log('Connecting to Google Classroom...');
  });
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize theme
  themeManager.initialize();
  
  // Display version information
  const versionElements = document.querySelectorAll('.versions li');
  if (versionElements.length >= 3) {
    const electronVersion = versionElements[0];
    const chromeVersion = versionElements[1];
    const nodeVersion = versionElements[2];
    
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
  
  // Initialize focus tracker when in focus section
  const focusContainer = document.getElementById('focus-tracking-container');
  if (focusContainer) {
    try {
      await focusTracker.initialize(focusContainer);
      console.log('Focus tracker initialized');
    } catch (error) {
      console.error('Error initializing focus tracker:', error);
      focusContainer.innerHTML = `
        <div class="error-message">
          <p>Error initializing focus tracking: ${error.message}</p>
          <button class="primary-button" id="retry-focus">Retry</button>
        </div>
      `;
      
      document.getElementById('retry-focus')?.addEventListener('click', async () => {
        try {
          await focusTracker.initialize(focusContainer);
        } catch (retryError) {
          console.error('Failed to initialize focus tracker on retry:', retryError);
        }
      });
    }
  }
  
  // Create placeholder chart
  createFocusChart();
  
  // Initialize navigation
  initNavigation();
  
  // Initialize settings
  initSettings();
});