const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function notarize({ appOutDir, packager }) {
  if (packager.platform.name !== 'mac') return;

  const appName = packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const zipPath = path.join(appOutDir, `${appName}-notarize.zip`);

  console.log(`\n📦 Zipping for notarization: ${appPath}`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

  console.log('🔏 Submitting to Apple notarization service (this may take a few minutes)...');
  execSync(
    `xcrun notarytool submit "${zipPath}" --keychain-profile "VoiceInk-Notarize" --wait`,
    { stdio: 'inherit' }
  );

  try { fs.unlinkSync(zipPath); } catch (e) {}

  console.log('📎 Stapling notarization ticket...');
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
  console.log('✅ Notarization complete.\n');
};
