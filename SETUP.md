# LoveWords — Setup Guide 💌

A no-ads Words with Friends clone built just for you two.

## 1. Firebase Setup (required)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project called **lovewords**
3. Enable **Email/Password** authentication (Authentication → Sign-in method)
4. Create a **Firestore Database** (start in production mode)
5. Copy your **web app config** and paste it into `src/firebase/config.ts`
6. Deploy the security rules: `firebase deploy --only firestore:rules`

### Add playerUids field to games (important for Firestore queries)

In `src/firebase/gameService.ts`, the `createGame` function already stores `playerUids` — make sure
you keep this field when saving games so the Firestore rules can query by player.

## 2. Push Notifications (optional but nice)

1. Install EAS CLI: `npm install -g eas-cli`
2. Run `eas build:configure` to get your project ID
3. Update `app.json` with your EAS project ID
4. Use Expo's push notification service to send turn alerts from a Cloud Function

## 3. Run the App

```bash
cd lovewords
npx expo start
```

Then scan the QR code with the **Expo Go** app on your iPhone.

## 4. Build for iOS (to install without App Store)

```bash
npx eas build --platform ios --profile preview
```

This creates an `.ipa` you can install via TestFlight or directly.

## Project Structure

```
src/
  engine/         # Game logic (board, tiles, scoring, dictionary)
  firebase/       # Firebase config + services
  components/     # Board, Tile, TileRack, ScoreBoard
  screens/        # Auth, Lobby, Game, LoveNotes
  hooks/          # useAuth
  types/          # TypeScript types
  utils/          # Colors, notifications
```

## Features

- Full 15×15 board with WWF bonus squares
- 7-tile rack with drag-to-place mechanic
- Word validation via dictionary API
- Scoring with letter/word multipliers + bingo bonus (7 tiles = +35 pts)
- Async multiplayer via Firebase Firestore
- 💌 Love notes between games — sweet messages instead of ads!
- Push notifications when it's your turn
