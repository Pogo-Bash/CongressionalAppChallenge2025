import * as tf from '@tensorflow/tfjs';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';

class TensorFlowService {
  constructor() {
    this.faceModel = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Set backend based on platform
      if (window.platform && window.platform.isDesktop) {
        // Use WebGL backend for desktop
        await tf.setBackend('webgl');
      } else {
        // Use best available backend for mobile
        if (tf.engine().backendNames().includes('webgl')) {
          await tf.setBackend('webgl');
        } else {
          await tf.setBackend('cpu');
        }
      }

      // Initialize face detection model using the updated API
      const detectorConfig = {
        runtime: 'mediapipe', // or 'tfjs'
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
        maxFaces: 1
      };
      
      this.faceDetector = await faceLandmarksDetection.createDetector(
        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
        detectorConfig
      );

      this.isInitialized = true;
      console.log('TensorFlow initialized successfully');
    } catch (error) {
      console.error('Failed to initialize TensorFlow:', error);
      throw error;
    }
  }

  // Focus tracking function using eye blink detection
  async detectBlinks(videoElement) {
    if (!this.isInitialized || !this.faceDetector) {
      throw new Error('TensorFlow not initialized');
    }

    const faces = await this.faceDetector.estimateFaces(videoElement);

    if (faces.length === 0) {
      return { isBlinking: false, eyeOpenness: 1.0, faceDetected: false };
    }

    // Process face landmarks to detect blinks
    const face = faces[0];
    
    // The format has changed - we need to extract keypoints from the new format
    const keypoints = face.keypoints;
    
    // Get eye keypoints (indices may vary based on the model)
    const leftEyePoints = keypoints.filter(kp => 
      kp.name && kp.name.includes('leftEye')
    );
    
    const rightEyePoints = keypoints.filter(kp => 
      kp.name && kp.name.includes('rightEye')
    );
    
    if (leftEyePoints.length === 0 || rightEyePoints.length === 0) {
      return { isBlinking: false, eyeOpenness: 1.0, faceDetected: true };
    }

    // Calculate eye openness - this is a simplified approach
    const leftEyeOpenness = this.calculateEyeOpennessFromKeypoints(leftEyePoints);
    const rightEyeOpenness = this.calculateEyeOpennessFromKeypoints(rightEyePoints);
    const eyeOpenness = (leftEyeOpenness + rightEyeOpenness) / 2;

    // Consider blinking if eye openness is below threshold
    const isBlinking = eyeOpenness < 0.3;

    return {
      isBlinking,
      eyeOpenness,
      faceDetected: true
    };
  }

  calculateEyeOpennessFromKeypoints(eyePoints) {
    // Find top and bottom points of the eye
    let topY = Number.NEGATIVE_INFINITY;
    let bottomY = Number.POSITIVE_INFINITY;
    let topPoint, bottomPoint;
    
    eyePoints.forEach(point => {
      if (point.y < bottomY) {
        bottomY = point.y;
        bottomPoint = point;
      }
      if (point.y > topY) {
        topY = point.y;
        topPoint = point;
      }
    });
    
    if (!topPoint || !bottomPoint) {
      return 1.0; // Default to eyes open if can't determine
    }
    
    // Calculate vertical distance
    const distance = Math.abs(topPoint.y - bottomPoint.y);
    
    // Normalize by face size (here we're using a simplistic approach)
    // You might want to normalize by the face bounding box size
    return distance / 30;
  }
}

// Singleton instance
export const tensorflowService = new TensorFlowService();