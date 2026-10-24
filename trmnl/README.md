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
   - **Polling URL**: `https://planetfinder-web-2605.web.app/api/trmnl?lat={{lat}}&lon={{lon}}&tz={{tz}}`
   - **Refresh Rate**: Every 1 hour (or as desired).

### 2. Form Fields
The form fields are defined in [settings.yml](settings.yml): `lat`, `lon`, an optional `tz` (time zone name such as `America/New_York`), and the author bio. Importing `settings.yml` sets them up; there is no need to add them by hand.

### 3. Configure the Markup
1. In the plugin's **Markup** editor, paste [shared.liquid](shared.liquid) into the **Shared** tab. It defines the title bar used by every layout.
2. Paste [full.liquid](full.liquid), [half_horizontal.liquid](half_horizontal.liquid), [half_vertical.liquid](half_vertical.liquid) and [quadrant.liquid](quadrant.liquid) into the matching layout tabs.
3. Save the settings.

The title bar icon is served from `https://planetfinder-web-2605.web.app/trmnl-icon.svg` (a copy of [icon.svg](icon.svg) in `public/`), so it needs a hosting deploy.

## How it Works

1. The TRMNL server polls the URL: `https://<your-app>.web.app/api/trmnl?lat=X&lon=Y`.
2. The Firebase Cloud Function `trmnl` executes, calculates planet positions, the moon phase and the next sky event (curated planet events, meteor showers, equinoxes and solstices) for the coordinates `X` and `Y` at the current time, and returns a JSON payload. Invalid coordinates fall back to New York and set `coords_error`, which the title bar shows.
3. The TRMNL rendering engine parses the JSON, binds the values into the Liquid markup template, and requests the SVG image: `https://<your-app>.web.app/api/sky.svg?lat=X&lon=Y` to render the sky map.
4. The Firebase Cloud Function `sky` generates the vector SVG dynamically, plotting stars, constellations, and visible planets.
5. The combined screen is compiled and sent to your TRMNL e-paper display!
