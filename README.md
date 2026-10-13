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

Home (`/`) and Suggestions (`/suggestions`) are Expo Router tabs. The hamburger opens the Google account screen (`/sign-in`). Organizer, composer, and contact remain visual placeholders. Suggestions contains its heading and one neutral demo thumbnail, ready for future content.

The layout follows the supplied 402 × 874 Figma reference. Wider windows center the 402-point shell; narrower devices use the available width. Bottom controls account for device safe areas. Fonts are bundled locally through the Expo Google Fonts packages; icons use Phosphor.

`src/theme.ts` contains shared colors and font families, including the Poppins and date fonts reserved for future suggestion rows. `OVERVIEW.md` describes the larger product.

The modular Supabase API lives in `api/`. See [API setup and usage](api/README.md) for public `getSuggestions({ topicId })`, and [Google authentication setup](api/AUTH_SETUP.md) for sign-in and private `getTasks()`. Suggestion/task data are not yet rendered by the screens.

The [background refresh framework](refresh/README.md) collects tasks/schedules placeholders when signed in, and public suggestions for locally selected topics in either state. It caches a typed snapshot and calls an AI processing placeholder. It refreshes approximately every 30 minutes and catches up on app resume. Topic selection is available through the `refresh/` module; no selection screen is included yet.
