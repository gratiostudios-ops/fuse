const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const networkConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="false">alywupikkwckztnwvckp.supabase.co</domain>
    <trust-anchors>
      <certificates src="system" />
      <certificates src="@raw/gts_root_r4" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`;

module.exports = function withSupabaseAndroidTrust(config) {
  config = withAndroidManifest(config, config => {
    const application = config.modResults.manifest.application[0];
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });

  return withDangerousMod(config, ['android', async config => {
    const res = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
    const xmlDir = path.join(res, 'xml');
    const rawDir = path.join(res, 'raw');
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), networkConfig);
    fs.copyFileSync(
      path.join(__dirname, 'assets/gts_root_r4.pem'),
      path.join(rawDir, 'gts_root_r4.pem'),
    );
    return config;
  }]);
};
