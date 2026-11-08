const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    prune: true,
    executableName: 'genisys',
    icon: 'assets/icon', // picks assets/icon.ico on Windows
    extraResource: ['assets', 'actions'], // window/toast icons + the action folders, read from process.resourcesPath
  },
  hooks: {
    // Slimmer package: keep only the en-US locale, drop the Chromium license page, and drop the DirectX shader
    // compiler that only WebGPU uses (~27 MB; the app uses WebGL, which goes through d3dcompiler_47.dll instead).
    postPackage: async (_cfg, { outputPaths }) => {
      const fs = require('node:fs'); const path = require('node:path');
      for (const dir of outputPaths) {
        const loc = path.join(dir, 'locales');
        if (fs.existsSync(loc)) for (const f of fs.readdirSync(loc)) if (f !== 'en-US.pak') fs.rmSync(path.join(loc, f));
        for (const f of ['LICENSES.chromium.html', 'dxcompiler.dll', 'dxil.dll']) fs.rmSync(path.join(dir, f), { force: true });
      }
    },
  },
  rebuildConfig: {},
  // No Squirrel maker: its installer is a fixed gif screen. The installer is built with Inno Setup instead
  // (see installer/genisys.iss and installer/build-installer.bat), which has a proper wizard with an install-location page.
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin', 'linux'] },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
