# TRMNL PlanetFinder Plugin Setup Guide

This guide describes how to configure your custom private plugin on the **TRMNL Dashboard** to display the PlanetFinder sky map and statistics on your e-paper screen.

## Prerequisites

1. Your PlanetFinder application must be deployed to Firebase. Note your Firebase domain (e.g., `https://planetfinder-web-2605.web.app`).
2. Run `firebase deploy` in this project to push the Cloud Functions backend and hosting rewrites.

## Setup Instructions

### 1. Create a Private Plugin in TRMNL
1. Go to your **TRMNL Dashboard** -> **Plugins**.
2. Click **Add Private Plugin** (or **Custom Plugin**).
3. Set the following settings:
   - **Name**: `Planet Finder`
   - **Data Strategy**: `Polling`
   - **Polling URL**: `https://<YOUR_PROJECT_ID>.web.app/api/trmnl?lat=<YOUR_LATITUDE>&lon=<YOUR_LONGITUDE>`
     * *Example*: `https://planetfinder-web-2605.web.app/api/trmnl?lat=40.7128&lon=-74.0060`
     * (Replace `<YOUR_PROJECT_ID>`, `<YOUR_LATITUDE>`, and `<YOUR_LONGITUDE>` with your project's ID and your local coordinates).
   - **Refresh Rate**: Every 1 hour (or as desired).

### 2. Configure the Markup
1. In your new TRMNL plugin, go to the **Developer / Markup** tab.
2. Select **Full Width / Height** template (`full.liquid`).
3. Copy and paste the contents of [full.liquid](full.liquid) into the editor.
4. Locate the `<img>` tag in the markup:
   ```html
   <img src="https://YOUR_FIREBASE_PROJECT_ID.web.app/api/sky.svg?lat={{ latitude }}&lon={{ longitude }}" ... />
   ```
   Replace `YOUR_FIREBASE_PROJECT_ID` with your actual Firebase Project ID (e.g. `planetfinder-web-2605`).
5. Save the settings.

## How it Works

1. The TRMNL server polls the URL: `https://<your-app>.web.app/api/trmnl?lat=X&lon=Y`.
2. The Firebase Cloud Function `trmnl` executes, calculates planet positions and the moon phase for the coordinates `X` and `Y` at the current time, and returns a JSON payload.
3. The TRMNL rendering engine parses the JSON, binds the values into the Liquid markup template, and requests the SVG image: `https://<your-app>.web.app/api/sky.svg?lat=X&lon=Y` to render the sky map.
4. The Firebase Cloud Function `sky` generates the vector SVG dynamically, plotting stars, constellations, and visible planets.
5. The combined screen is compiled and sent to your TRMNL e-paper display!
