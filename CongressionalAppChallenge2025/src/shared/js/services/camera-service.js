class CameraService {
    constructor() {
      this.stream = null;
      this.videoElement = null;
    }
  
    async initialize(videoElement) {
      this.videoElement = videoElement;
      
      try {
        // Request camera permission and access
        const constraints = {
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        };
        
        // Handle platform differences
        if (window.platform && window.platform.isMobile && window.navigator.mediaDevices.getUserMedia) {
          // Mobile browser approach
          this.stream = await window.navigator.mediaDevices.getUserMedia(constraints);
        } else if (window.platform && window.platform.isDesktop) {
          // Electron approach
          this.stream = await window.navigator.mediaDevices.getUserMedia(constraints);
        } else {
          throw new Error('Camera access not supported on this platform');
        }
        
        // Connect stream to video element
        this.videoElement.srcObject = this.stream;
        
        // Wait for video to be ready
        return new Promise((resolve) => {
          this.videoElement.onloadedmetadata = () => {
            this.videoElement.play();
            resolve(true);
          };
        });
      } catch (error) {
        console.error('Failed to initialize camera:', error);
        throw error;
      }
    }
    
    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      
      if (this.videoElement) {
        this.videoElement.srcObject = null;
      }
    }
  }
  
  export const cameraService = new CameraService();