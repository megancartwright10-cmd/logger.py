# Ride Next (version 3: Disneyland Resort + Disneyland Paris)

The whole app is in `App.js`. It reads:
- live waits from the free ThemeParks.wiki feed, every 3 minutes
- typical waits, ride/restaurant locations and food tags from `data/app/disneyland-resort.json` and `data/app/disneyland-paris.json` in this repo (rebuilt nightly by the "Build app data" workflow)

## Try it on your phone (no installs)
1. Install **Expo Go** from the App Store or Google Play.
2. On a computer, open https://snack.expo.dev
3. Replace everything in its `App.js` with this repo's `App.js`.
4. If Snack offers to add missing packages (`expo-location`, `expo-notifications`, `expo-sensors`, `@react-native-async-storage/async-storage`, `react-native-view-shot`, `expo-sharing`, `expo-media-library`, `react-native-svg`), accept them all.
5. Click **My Device** and scan the QR code with your phone (Camera app on iPhone, Expo Go on Android).

## Run it as a real project (later)
```
npx create-expo-app ride-next --template blank
cd ride-next
npx expo install expo-location expo-notifications expo-sensors @react-native-async-storage/async-storage react-native-view-shot expo-sharing expo-media-library react-native-svg
```
Copy in `App.js` and `app.json`, then `npx expo start`.

## Publishing to the stores
Needs an Apple Developer account (yearly fee) and/or a Google Play developer account (one-off fee). Expo's EAS Build can build the iPhone version in the cloud, so a Mac isn't required. Change `bundleIdentifier` / `package` in `app.json` to your own before publishing.

## Day Wrapped (v4)
From **Your day** tap **See my Day Wrapped**: 7 story slides (9:16) in 9 palettes. Swipe the slide to change palette, tap its sides to move between slides. It opens in the palette for the land you spent most time in, or Christmas in December.
- **Share to Stories** saves the slide as a 1080×1920 picture and opens the share menu. Pick Instagram, then Story.
- In Expo Go, **Save image** may ask for photo access. A real build is needed for a direct "Instagram Stories" button (it also needs a Meta app ID).

## Walt Disney World (v5)
Orlando is the third city on the "Where are you visiting?" screen: Magic Kingdom, EPCOT, Hollywood Studios and Animal Kingdom (the water parks are left out). With Park Hopper on, a ride in another park gets ~40 minutes of travel added, because the parks are miles apart.
