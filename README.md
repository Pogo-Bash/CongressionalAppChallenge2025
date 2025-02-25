# Curriq 📚✨

Curriq helps students excel by creating personalized learning paths based on their actual classroom assignments and optimizing their study habits through focus tracking.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 🚀 Features

- **Smart Curriculum Generation:** Analyzes your Google Classroom assignments, tests, and quizzes to create tailored study plans
- **Focus Tracking:** Uses computer vision to monitor blink rate and posture, providing real-time feedback on concentration
- **Adaptive Pomodoro Timer:** Automatically adjusts study intervals based on detected focus levels
- **Performance Analytics:** Visualizes learning progress and identifies knowledge gaps
- **Collaborative Learning:** Share study plans and work together with classmates

## 📋 Prerequisites

- Node.js (v16+)
- npm or yarn
- Google account with access to Google Classroom
- For mobile development: Android Studio and/or Xcode

## 🔧 Installation

1. Clone the repository

   ```
   git clone https://github.com/Pogo-Bash/CongressionalAppChallenge2025.git
   cd CongressionalAppChallenge2025
   ```

2. Install dependencies

   ```
   npm install
   ```

3. Configure environment variables

   ```
   cp .env.example .env
   ```

   Edit `.env` with your Firebase and Google API credentials

4. Start the desktop development server
   ```
   npm run dev
   ```

## 🏗️ Technology Stack

- **Electron:** Cross-platform desktop application framework
- **Cordova:** Mobile application framework
- **TensorFlow.js:** Machine learning for curriculum analysis and recommendation
- **OpenCV:** Computer vision for focus and posture tracking
- **Firebase:** Authentication and data storage
- **D3.js/Chart.js:** Data visualization
- **Google Classroom API:** Educational data integration

## 📱 Mobile App

Curriq is available both as a desktop application and a mobile app to provide a seamless learning experience across all your devices.

### Mobile Features

- Cross-platform support for iOS and Android devices
- Synchronize your curriculum and progress across devices
- Simplified focus tracking using the mobile device's camera
- Mobile-optimized interface for studying on the go
- Offline mode for studying without internet connection

### Mobile Development

The mobile version of Curriq is built using:
- **Cordova:** For wrapping the application and accessing native device features
- **HTML5/CSS3/JavaScript:** Core web technologies for the interface
- **MediaPipe:** Mobile-optimized computer vision for focus tracking

### Building the Mobile App

```bash
# Install Cordova globally if not already installed
npm install -g cordova

# Build and run on Android
npm run mobile:android

# Build and run on iOS (macOS only)
npm run mobile:ios

# Test in browser
npm run mobile:browser
```

### Mobile-Desktop Sync

Your study data automatically synchronizes between mobile and desktop applications when you're online, allowing you to:
- Start a study session on desktop and continue on mobile
- Review focus analytics across all your devices
- Share curriculum with classmates regardless of platform

## 👩‍💻 Development

### Project Structure

```
curriculum-ai/
├── desktop/               # Electron desktop app
│   ├── main.js            # Electron main process
│   ├── preload.js         # Preload script for secure API access
│   └── src/               # Renderer process code
├── mobile/                # Cordova mobile app
│   ├── config.xml         # Cordova configuration
│   ├── platforms/         # Platform-specific code
│   └── www/               # Web assets for mobile
├── shared/                # Shared code between platforms
│   ├── js/                # Common JavaScript modules
│   ├── css/               # Shared styles
│   └── assets/            # Images and other assets
├── tests/                 # Test files
└── docs/                  # Documentation
```

### Branch Strategy

We use a simplified GitFlow workflow:

- `main`: Production-ready code
- `develop`: Integration branch
- Feature branches: `feature/feature-name`
- Bug fixes: `fix/bug-description`

### Development Workflow

1. Create a new branch from `develop`
2. Implement your changes
3. Submit a pull request to `develop`
4. After review, your changes will be merged

### Build Scripts

```bash
# Desktop development
npm run desktop:dev        # Start Electron in development mode
npm run desktop:build      # Build desktop application

# Mobile development
npm run mobile:dev         # Start mobile development server
npm run mobile:build       # Build mobile web assets
npm run mobile:android     # Build and run on Android
npm run mobile:browser     # Test in browser

# Shared code
npm run copy-shared        # Copy shared code to both platforms
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👥 Team

- jmwalker: https://github.com/jmwalker8
- Pogo-Bash: https://github.com/Pogo-Bash 

## 🙏 Acknowledgments

- [Congressional App Challenge](https://www.congressionalappchallenge.us/) for inspiring this project
- All the educators and students who provided feedback during development
