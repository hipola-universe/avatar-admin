# Prairie Assets Needed

To complete the prairie theme conversion, you'll need to create or download these assets:

## Required Files:

### 1. **prairie_tileset.png**
- A tileset image containing prairie/grass tiles
- Should include: different grass textures, flowers, small bushes, dirt paths
- Recommended size: 256x256 or 512x512 pixels
- Individual tiles should be 32x32 pixels

### 2. **prairie.json**
- A Tiled map file that uses the prairie tileset
- Should have a layer named "Grass" (referenced in the code)
- You can create this using the free Tiled map editor: https://www.mapeditor.org/

### 3. **prairie_sky.png**
- A prairie sky background image
- Should show blue sky, maybe some distant hills
- Recommended size: 800x600 pixels or larger

### 4. **clouds.png**
- White fluffy clouds for the sky
- Should have transparency (PNG format)
- Will be animated to drift across the sky

## Where to Find Assets:

1. **Free Game Assets:**
   - OpenGameArt.org
   - itch.io (search for "prairie tileset")
   - Kenny.nl (has great nature tilesets)

2. **Create Your Own:**
   - Use Pixelorama, Aseprite, or GIMP
   - Keep the pixel art style consistent with your existing sprites

3. **Temporary Fallback:**
   - You can temporarily rename your existing `tmw_desert_spacing.png` to `prairie_tileset.png`
   - And `desert.json` to `prairie.json` just to test the code changes

## Current Effects:
- 🌾 Grass particles blowing in the wind
- ☁️ Drifting clouds
- 🌸 Pollen/seed particles floating
- 🌅 Warm golden/green lighting
- 💬 Prairie-themed chat messages

The code is ready - just add the asset files to your resources folder! 