const fs = require('fs-extra');
const path = require('path');

fs.copySync(
    path.join(__dirname, '../shared'),
    path.join(__dirname, '../src/shared')
)

fs.copySync(
    path.join(__dirname, '../shared'),
    path.join(__dirname, '../mobile/www/shared')
)

console.log('Shared files copied to both platforms');