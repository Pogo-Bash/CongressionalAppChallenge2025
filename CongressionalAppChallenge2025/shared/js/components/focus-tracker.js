import { tensorflowService } from '../services/tensorflow-service.js';
import { cameraService } from '../services/camera-service.js';

class FocusTracker {
  constructor() {
    this.isTracking = false;
    this.focusData = {
      startTime: null,
      endTime: null,
      blinkRate: 0,
      attentionScore: 100,
      distractions: 0,
      blinkEvents: []
    };
    this.videoElement = null;
    this.trackingInterval = null;
    this.domElements = {};
  }

  async initialize(containerElement) {
    // Create UI elements
    this.createUI(containerElement);
    
    try {
      // Initialize TensorFlow
      await tensorflowService.initialize();
      
      // Set up event listeners
      this.setupEventListeners();
      
      return true;
    } catch (error) {
      console.error('Failed to initialize focus tracker:', error);
      this.showError('Failed to initialize focus tracking: ' + error.message);
      return false;
    }
  }
  
  createUI(containerElement) {
    containerElement.innerHTML = `
      <div class="focus-tracker">
        <div class="video-container">
          <video id="focus-video" width="320" height="240" autoplay muted></video>
          <canvas id="focus-overlay" width="320" height="240"></canvas>
        </div>
        <div class="focus-stats">
          <div class="focus-score">
            <span id="focus-score-value">100</span>
            <span>Focus Score</span>
          </div>
          <div class="focus-metrics">
            <div>Blink Rate: <span id="blink-rate">0</span>/min</div>
            <div>Distractions: <span id="distraction-count">0</span></div>
            <div>Session Time: <span id="session-time">00:00</span></div>
          </div>
        </div>
        <div class="focus-controls">
          <button id="start-tracking">Start Tracking</button>
          <button id="stop-tracking" disabled>Stop Tracking</button>
        </div>
        <div id="focus-error" class="focus-error"></div>
      </div>
    `;
    
    // Store references to DOM elements
    this.videoElement = document.getElementById('focus-video');
    this.domElements = {
      overlay: document.getElementById('focus-overlay'),
      focusScore: document.getElementById('focus-score-value'),
      blinkRate: document.getElementById('blink-rate'),
      distractionCount: document.getElementById('distraction-count'),
      sessionTime: document.getElementById('session-time'),
      startButton: document.getElementById('start-tracking'),
      stopButton: document.getElementById('stop-tracking'),
      errorContainer: document.getElementById('focus-error')
    };
  }
  
  setupEventListeners() {
    this.domElements.startButton.addEventListener('click', () => this.startTracking());
    this.domElements.stopButton.addEventListener('click', () => this.stopTracking());
  }
  
  async startTracking() {
    if (this.isTracking) return;
    
    try {
      // Start camera
      await cameraService.initialize(this.videoElement);
      
      // Reset focus data
      this.focusData = {
        startTime: Date.now(),
        endTime: null,
        blinkRate: 0,
        attentionScore: 100,
        distractions: 0,
        blinkEvents: []
      };
      
      // Update UI
      this.domElements.startButton.disabled = true;
      this.domElements.stopButton.disabled = false;
      this.isTracking = true;
      
      // Start tracking loop
      this.trackingInterval = setInterval(() => this.trackFocus(), 100);
      
      // Start session timer
      this.timerInterval = setInterval(() => this.updateSessionTime(), 1000);
      
    } catch (error) {
      console.error('Failed to start tracking:', error);
      this.showError('Failed to start tracking: ' + error.message);
    }
  }
  
  stopTracking() {
    if (!this.isTracking) return;
    
    // Stop camera
    cameraService.stop();
    
    // Stop intervals
    clearInterval(this.trackingInterval);
    clearInterval(this.timerInterval);
    
    // Update focus data
    this.focusData.endTime = Date.now();
    
    // Update UI
    this.domElements.startButton.disabled = false;
    this.domElements.stopButton.disabled = true;
    this.isTracking = false;
    
    // Final update
    this.updateStats();
    
    // Return session data
    return this.focusData;
  }
  
  async trackFocus() {
    if (!this.isTracking) return;
    
    try {
      const blinkData = await tensorflowService.detectBlinks(this.videoElement);
      
      // Update blink events
      if (blinkData.isBlinking) {
        this.focusData.blinkEvents.push({
          timestamp: Date.now(),
          eyeOpenness: blinkData.eyeOpenness
        });
      }
      
      // Calculate current blink rate (blinks per minute)
      const sessionDurationMinutes = (Date.now() - this.focusData.startTime) / 60000;
      this.focusData.blinkRate = this.focusData.blinkEvents.length / Math.max(sessionDurationMinutes, 0.1);
      
      // Update attention score based on blink rate and face detection
      if (!blinkData.faceDetected) {
        // Face not detected - potential distraction
        this.focusData.attentionScore = Math.max(this.focusData.attentionScore - 5, 0);
        this.focusData.distractions++;
      } else if (this.focusData.blinkRate > 30) {
        // Blink rate too high - potential fatigue
        this.focusData.attentionScore = Math.max(this.focusData.attentionScore - 1, 20);
      } else if (this.focusData.blinkRate < 5) {
        // Blink rate too low - potential staring
        this.focusData.attentionScore = Math.max(this.focusData.attentionScore - 1, 40);
      } else {
        // Normal blink rate - good focus
        this.focusData.attentionScore = Math.min(this.focusData.attentionScore + 1, 100);
      }
      
      // Update UI
      this.updateStats();
      
    } catch (error) {
      console.error('Error during focus tracking:', error);
    }
  }
  
  updateStats() {
    this.domElements.focusScore.textContent = Math.round(this.focusData.attentionScore);
    this.domElements.blinkRate.textContent = Math.round(this.focusData.blinkRate);
    this.domElements.distractionCount.textContent = this.focusData.distractions;
  }
  
  updateSessionTime() {
    const sessionDurationSeconds = Math.floor((Date.now() - this.focusData.startTime) / 1000);
    const minutes = Math.floor(sessionDurationSeconds / 60).toString().padStart(2, '0');
    const seconds = (sessionDurationSeconds % 60).toString().padStart(2, '0');
    this.domElements.sessionTime.textContent = `${minutes}:${seconds}`;
  }
  
  showError(message) {
    this.domElements.errorContainer.textContent = message;
    this.domElements.errorContainer.style.display = 'block';
    setTimeout(() => {
      this.domElements.errorContainer.style.display = 'none';
    }, 5000);
  }
}

export const focusTracker = new FocusTracker();