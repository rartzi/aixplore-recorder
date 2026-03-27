const { execSync } = require('child_process');
const path = require('path');

exports.default = async function notarize({ appOutDir, packager }) {
  if (packager.platform.name !== 'mac') return;

  const appName = packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n📦 Notarizing: ${appPath}`);
  execSync(
    `xcrun notarytool submit "${appPath}" --keychain-profile "VoiceInk-Notarize" --wait`,
    { stdio: 'inherit' }
  );

  console.log('📎 Stapling notarization ticket...');
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
  console.log('✅ Notarization complete.\n');
};
