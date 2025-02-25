import React from 'react';

function App() {
  return (
    <div className="flex h-screen bg-gray-100">
      <div className="m-auto p-8 bg-white rounded-lg shadow-lg">
        <h1 className="text-3xl font-bold text-blue-600 mb-4">CurriculumAI</h1>
        <p className="text-gray-700" id="info">
          This app is using Node.js {window.versions.node()}, Chrome {window.versions.chrome()}, 
          and Electron {window.versions.electron()}
        </p>
      </div>
    </div>
  );
}

export default App;