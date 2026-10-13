# Fuse

An Expo React Native UI shell for Android, iOS, and web, written in TypeScript.

## Run

```sh
npm install
npm start
```

Open with a compatible Expo Go app, or use `npm run android`, `npm run ios` (macOS with Xcode), or `npm run web`.

## Check

```sh
npm run typecheck
npm run export
```

Home (`/`) and Suggestions (`/suggestions`) are Expo Router tabs. Only tab navigation is implemented. The Organizer, menu, composer, and contact label are visual placeholders. Suggestions contains its heading and one neutral demo thumbnail, ready for future content.

The layout follows the supplied 402 × 874 Figma reference. Wider windows center the 402-point shell; narrower devices use the available width. Bottom controls account for device safe areas. Fonts are bundled locally through the Expo Google Fonts packages; icons use Phosphor.

`src/theme.ts` contains shared colors and font families, including the Poppins and date fonts reserved for future suggestion rows. `OVERVIEW.md` describes the larger product; its backend and integrations are not implemented here.
