# Hospital Asset Tracking System

## Overview
This project is a WiFi-based hospital asset tracking system that helps staff locate equipment in real time using ESP32 devices, a backend server, and a web interface.

## Problem
Hospital staff often waste time searching for equipment, which reduces efficiency and can impact patient care.

## Solution
This system tracks equipment using ESP32 devices connected to WiFi. Data is sent to a server and displayed on a live map where users can search and locate assets.

## How It Works
- ESP32 sends data over WiFi  
- Server receives and processes data  
- Cisco Spaces determines location  
- Website displays equipment on a map  

## Features
- Real-time tracking  
- Search and filter  
- Live map with pins  
- Battery display  
- Heatmap for missing assets  

## Technologies Used
- ESP32  
- Node.js + Express  
- HTML, CSS, JavaScript  
- Cisco Spaces  

## Setup
1. Run `npm install`  
2. Create a `.env` file with your token  
3. Run `node server.js`  
4. Open the website  

## Authors
Team 24 – Asset Tracking
