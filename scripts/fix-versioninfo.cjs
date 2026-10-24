const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;
  let ResEdit;
  try {
    ResEdit = require('resedit');
  } catch (error) {
    console.warn('[fix-versioninfo] resedit unavailable:', error.message);
    return;   // option: module load fail par build nahi roko
  }
  const { NtExecutable, NtExecutableResource, Resource } = ResEdit;

  const exePath = path.join(context.appOutDir, 'RuntimeHost.exe');
  if (!fs.existsSync(exePath)) return;

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  res.entries = res.entries.filter((e) => e.type !== 16);   // RT_VERSION hatao, Electron ka SquirrelAwareVersion bhi saath jayega

  const vi = Resource.VersionInfo.create({ lang: 1033, fixedInfo: {}, strings: [] });   // option: resedit 1.7 create args required
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    OriginalFilename: 'RuntimeHost.exe',
    InternalName: 'RuntimeHost',
    FileDescription: 'RuntimeHost',
    ProductName: 'RuntimeHost',
    CompanyName: 'RuntimeHost',
    LegalCopyright: 'RuntimeHost',
    LegalTrademarks: 'RuntimeHost'
  });
  vi.setFileVersion(10, 0, 0, 0);
  vi.setProductVersion(10, 0, 0, 0);

  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[fix-versioninfo] scrubbed', exePath);
};
