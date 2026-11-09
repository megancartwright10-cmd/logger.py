# Ride Next (version 2: Disneyland Resort)

The whole app is in `App.js`. It reads:
- live waits from the free ThemeParks.wiki feed, every 3 minutes
- typical waits, ride/restaurant locations and food tags from `data/app/disneyland-resort.json` in this repo (rebuilt nightly by the "Build app data" workflow)

## Try it on your phone (no installs)
1. Install **Expo Go** from the App Store or Google Play.
2. On a computer, open https://snack.expo.dev
3. Replace everything in its `App.js` with this repo's `App.js`.
4. If Snack offers to add missing packages (`expo-location`, `expo-notifications`, `expo-sensors`, `@react-native-async-storage/async-storage`), accept them all.
5. Click **My Device** and scan the QR code with your phone (Camera app on iPhone, Expo Go on Android).

## Run it as a real project (later)
```
npx create-expo-app ride-next --template blank
cd ride-next
npx expo install expo-location expo-notifications expo-sensors @react-native-async-storage/async-storage
```
Copy in `App.js` and `app.json`, then `npx expo start`.

## Publishing to the stores
Needs an Apple Developer account (yearly fee) and/or a Google Play developer account (one-off fee). Expo's EAS Build can build the iPhone version in the cloud, so a Mac isn't required. Change `bundleIdentifier` / `package` in `app.json` to your own before publishing.
