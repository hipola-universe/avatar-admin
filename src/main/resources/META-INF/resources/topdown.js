var config = {
    type: Phaser.AUTO,
    width: 1024,
    height: 768,
    parent: 'phaser-container',
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false
        }
    }
};

var game = new Phaser.Game(config);

// Add button event listener for manually adding avatars
document.addEventListener("DOMContentLoaded", function() {
    const addAvatarButton = document.getElementById('addAvatar');
    
    if (addAvatarButton) {
        addAvatarButton.addEventListener('click', function() {
            // Add visual feedback
            addAvatarButton.classList.add('retro-btn-active');
            setTimeout(() => {
                addAvatarButton.classList.remove('retro-btn-active');
            }, 400);
            
            // Get the current scene
            const scene = game.scene.scenes[0];
            
            // Call handleJoiner with mock data
            const mockJoinerEvent = {
                sender: 'manual',
                message: 'Manual avatar added'
            };
            
            handleJoiner(mockJoinerEvent, scene);
            
            console.log('Manual avatar added!');
        });
    }
});
// Define text box style and text content
const padding = 20;
const cornerRadius = 20;
const borderColor = 0x000000; // Black border
const borderWidth = 4;
const backgroundColor = 0xFFFFFF; // White background
const textColor = '#000000'; // Black text
// All bubbles and messages are now handled dynamically

// Game objects
var map, tileset, layer;
var dreamParticles, starParticles;
var ambientLight;

// Dynamic avatars system
var dynamicAvatars = [];
var avatarColors = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0x96ceb4, 0xffeaa7, 0xdda0dd, 0xf4a261, 0x2a9d8f];
var avatarSizes = [1.0, 1.1, 1.3, 0.9, 1.4];
var currentColorIndex = 0;
var currentSizeIndex = 0;

// Proximity and chat system
var proximityThreshold = 100; // Distance for sharing light
var chatCooldown = 5000; // 5 seconds between auto-chats
var lastChatTime = 0;
// All conversations will be dynamic between avatars

function preload() {
    // Load prairie tilemap (you'll need to create/download these assets)
    this.load.image('prairie-tiles', 'prairie_tileset.png');
    this.load.tilemapTiledJSON('prairie-map', 'prairie-map.json');
    
    // Load character sprites
    this.load.spritesheet('bob', 'dude.png', { frameWidth: 32, frameHeight: 48 });
    this.load.spritesheet('alice', 'dude2.png', { frameWidth: 32, frameHeight: 48 });
    
    // Load prairie background elements
    //this.load.image('prairie-sky', 'prairie_sky.png');
    // this.load.image('clouds', 'clouds.png');
    
    // Create a simple particle texture for dream effects
    //this.load.image('particle', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
    
    // Create grass particle texture for prairie wind effect
    this.load.image('grass-particle', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAGCAYAAADl3jPRAAAAQ0lEQVQIHQEKAKv/AAAAAP///wAAAAAA////AAAAAP///wAAAAAA////AAAAAP///wAAAAAA////AAAAAP///wAAAAAA////AAAAAP///wCODQk8dJJ5rgAAAABJRU5ErkJggg==');
}

function create() {
    // Create the prairie tilemap
    map = this.make.tilemap({ key: 'prairie-map' });
    tileset = map.addTilesetImage('Prairie', 'prairie-tiles');
    layer = map.createLayer('Grass', tileset, 0, 0); 
    // All characters will be created dynamically through handleJoiner events
    
    // Create walking animations for bob (based on original sprite layout)
    this.anims.create({
        key: 'bob-walk-down',
        frames: this.anims.generateFrameNumbers('bob', { start: 4, end: 4 }),
        frameRate: 8,
        repeat: -1
    });
    
    this.anims.create({
        key: 'bob-walk-left',
        frames: this.anims.generateFrameNumbers('bob', { start: 4, end: 0 }),
        frameRate: 8,
        repeat: -1
    });
    
    this.anims.create({
        key: 'bob-walk-right',
        frames: this.anims.generateFrameNumbers('bob', { start: 5, end: 8 }),
        frameRate: 8,
        repeat: -1
    });
    
    this.anims.create({
        key: 'bob-walk-up',
        frames: this.anims.generateFrameNumbers('bob', { start: 4, end: 4 }),
        frameRate: 8,
        repeat: -1
    });
    
    // Create walking animations for alice
    this.anims.create({
        key: 'alice-walk-down',
        frames: this.anims.generateFrameNumbers('alice', { start: 4, end: 4 }),
        frameRate: 8,
        repeat: -1
    });
    
    this.anims.create({
        key: 'alice-walk-left',
        frames: this.anims.generateFrameNumbers('alice', { start: 4, end: 0 }),
        frameRate: 8,
        repeat: -1
    });
    
    this.anims.create({
        key: 'alice-walk-right',
        frames: this.anims.generateFrameNumbers('alice', { start: 4, end: 0 }),
        frameRate: 8,
        repeat: -1
    });
    
    this.anims.create({
        key: 'alice-walk-up',
        frames: this.anims.generateFrameNumbers('alice', { start: 4, end: 4 }),
        frameRate: 8,
        repeat: -1
    });
    
    // Set up camera bounds (free roaming camera)
    this.cameras.main.setBounds(0, 0, map.widthInPixels || 800, map.heightInPixels || 600);
    
    // Add dreamy lighting effects with warmer prairie tones
    this.lights.enable();
    this.lights.setAmbientColor(0x808080);
    
    // Make layer receive light
    layer.setPipeline('Light2D');
    
    // Initialize SSE connection for chat
    var source = new EventSource("/initChat/stream");
    source.onmessage = (event) => {
        var data = JSON.parse(event.data);
        handleServerEvent(data, this);
    };
    
        var joinersSource = new EventSource('/initChat/joiners');
    joinersSource.onmessage = (event) => {
        var data = JSON.parse(event.data);
        handleJoiner(data, this);
    };
}

function update() {
    // Update lights for dynamic avatars
    dynamicAvatars.forEach(avatar => {
        if (avatar.light) {
            avatar.light.x = avatar.sprite.x;
            avatar.light.y = avatar.sprite.y;
        }
    });
    
    // Check proximity between characters and trigger chats
    checkProximityAndChat(this);
    
    // Update proximity visual indicators
    updateProximityIndicators();
}

function checkProximityAndChat(scene) {
    const currentTime = scene.time.now;
    
    // Skip if still in cooldown or not enough avatars
    if (currentTime - lastChatTime < chatCooldown || dynamicAvatars.length < 2) {
        return;
    }
    
    // Check proximity between all dynamic avatars
    for (let i = 0; i < dynamicAvatars.length; i++) {
        for (let j = i + 1; j < dynamicAvatars.length; j++) {
            const avatar1 = dynamicAvatars[i];
            const avatar2 = dynamicAvatars[j];
            
            const distance = Phaser.Math.Distance.Between(
                avatar1.sprite.x, avatar1.sprite.y,
                avatar2.sprite.x, avatar2.sprite.y
            );
            
            if (distance < proximityThreshold) {
                fetch('/initChat/' + avatar1.id + '/' + avatar2.id) 
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok ' + response.statusText);
                }
                return response.json();
            })
            .then(data => {
                console.log('Success:', data);
                // Do something with the response data
            })
            .catch(error => {
                console.error('Error:', error);
            });
                lastChatTime = currentTime;
                return;
            }
        }
    }
}

function triggerProximityChat(pairKey, scene, avatar1, avatar2) {
    const messages = [
        "Hello there, fellow prairie wanderer!",
        "The grasslands feel alive with so many of us here!",
        "Nice to meet another soul in this endless prairie!",
        "Your light adds such beauty to this meadow!",
        "Together we make the prairie more magical!",
        "What a lovely day to explore the endless grasslands!",
        "The prairie winds carry such peaceful whispers!",
        "I love how our lights dance together in this meadow!"
    ];
    
    const randomMessage = Phaser.Utils.Array.GetRandom(messages);
    
    // Randomly choose which avatar speaks
    const from = Math.random() > 0.5 ? avatar1.id : avatar2.id;
    const to = from === avatar1.id ? avatar2.id : avatar1.id;
    
    // Create chat event data
    const chatData = {
        from: from,
        to: to,
        message: randomMessage
    };
    
    // Trigger the chat display
    handleServerEvent(chatData, scene);
    
    // Add some visual feedback for the proximity chat
    createProximityEffect(scene, pairKey, avatar1, avatar2);
}

function createProximityEffect(scene, pairKey, avatar1, avatar2) {
    // Calculate center point between the two avatars
    const centerX = (avatar1.sprite.x + avatar2.sprite.x) / 2;
    const centerY = (avatar1.sprite.y + avatar2.sprite.y) / 2;
    
    // Create a brief light burst effect
    const lightBurst = scene.add.graphics();
    lightBurst.fillStyle(0xffffff, 0.8);
    lightBurst.fillCircle(centerX, centerY, 20);
    lightBurst.setBlendMode('ADD');
    
    // Animate the light burst
    scene.tweens.add({
        targets: lightBurst,
        scaleX: 3,
        scaleY: 3,
        alpha: 0,
        duration: 1000,
        ease: 'Power2',
        onComplete: () => {
            lightBurst.destroy();
        }
    });
    
    // Create connecting light particles
    const connectionParticles = scene.add.particles(centerX, centerY, 'particle', {
        scale: { start: 0.5, end: 0 },
        speed: { min: 20, max: 50 },
        lifespan: 1500,
        quantity: 8,
        tint: 0xffffff,
        alpha: { start: 0.8, end: 0 },
        blendMode: 'ADD'
    });
    
    // Stop particles after brief time
    scene.time.delayedCall(500, () => {
        connectionParticles.stop();
        scene.time.delayedCall(1500, () => {
            connectionParticles.destroy();
        });
    });
}

function updateProximityIndicators() {
    // Clear all existing graphics
    if (game.scene.scenes[0]) {
        const scene = game.scene.scenes[0];
        // Remove any existing connection graphics
        scene.children.list.forEach(child => {
            if (child.isConnectionLine) {
                child.destroy();
            }
        });
    }
    
    // Draw connection lines between close avatars
    for (let i = 0; i < dynamicAvatars.length; i++) {
        for (let j = i + 1; j < dynamicAvatars.length; j++) {
            const avatar1 = dynamicAvatars[i];
            const avatar2 = dynamicAvatars[j];
            
            const distance = Phaser.Math.Distance.Between(
                avatar1.sprite.x, avatar1.sprite.y,
                avatar2.sprite.x, avatar2.sprite.y
            );
            
            if (distance < proximityThreshold) {
                drawConnectionLine(avatar1, avatar2);
            }
        }
    }
}

function drawConnectionLine(avatar1, avatar2) {
    const scene = game.scene.scenes[0];
    const graphics = scene.add.graphics();
    graphics.isConnectionLine = true; // Mark for easy cleanup
    
    // Use a blend of both avatar colors
    const blendedColor = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(avatar1.color),
        Phaser.Display.Color.ValueToColor(avatar2.color),
        1,
        0.5
    );
    const lineColor = Phaser.Display.Color.GetColor32(blendedColor.r, blendedColor.g, blendedColor.b, 255);
    
    graphics.lineStyle(3, lineColor, 0.6);
    graphics.setBlendMode('ADD');
    graphics.beginPath();
    graphics.moveTo(avatar1.sprite.x, avatar1.sprite.y - 10);
    graphics.lineTo(avatar2.sprite.x, avatar2.sprite.y - 10);
    graphics.strokePath();
    
    // Add pulsing dots along the line
    const midX = (avatar1.sprite.x + avatar2.sprite.x) / 2;
    const midY = (avatar1.sprite.y + avatar2.sprite.y) / 2 - 10;
    graphics.fillStyle(lineColor, 0.8);
    graphics.fillCircle(midX, midY, 3);
}

function moveNPCRandomly(npc, characterName) {
    const directions = [
        { x: 0, y: -50, anim: characterName + '-walk-up' },
        { x: 0, y: 50, anim: characterName + '-walk-down' },
        { x: -50, y: 0, anim: characterName + '-walk-left' },
        { x: 50, y: 0, anim: characterName + '-walk-right' }
    ];
    
    const randomDirection = Phaser.Utils.Array.GetRandom(directions);
    
    // Stop current animation
    npc.anims.stop();
    
    // Apply velocity
    npc.body.setVelocity(randomDirection.x, randomDirection.y);
    
    // Play animation
    if (randomDirection.anim) {
        npc.anims.play(randomDirection.anim, true);
    }
    
    // Stop movement after a short time
    game.scene.scenes[0].time.delayedCall(1000, () => {
        npc.body.setVelocity(0);
        npc.anims.stop();
        // Set correct idle frame based on character
        if (characterName === 'bob') {
            npc.setFrame(5); // Bob's idle frame
        } else if (characterName === 'alice') {
            npc.setFrame(0); // Alice's idle frame
        }
    });
}

function handleJoiner(data, scene) {
    console.log('Joiner event:', data);
    
    // Create a new dynamic avatar
    const avatarId = data.sender;
    
    // Get random position within the map bounds
    const randomX = Phaser.Math.Between(100, 700);
    const randomY = Phaser.Math.Between(100, 500);
    
    // Create new avatar sprite using bob spritesheet
    const newAvatar = scene.physics.add.sprite(randomX, randomY, 'bob');
    
    // Get next color and size
    const avatarColor = avatarColors[currentColorIndex % avatarColors.length];
    const avatarSize = avatarSizes[currentSizeIndex % avatarSizes.length];
    
    // Apply tint and scale
    newAvatar.setTint(avatarColor);
    newAvatar.setScale(avatarSize);
    newAvatar.setCollideWorldBounds(true);
    newAvatar.body.setSize(20, 32);
    newAvatar.characterName = avatarId;
    newAvatar.setFrame(5); // Set idle frame
    newAvatar.setPipeline('Light2D'); // Enable lighting
    
    // Add light for the new avatar
    const light = scene.lights.addLight(newAvatar.x, newAvatar.y, 100, avatarColor, 0.5);
    newAvatar.light = light; // Store reference to light
    
    // Add to dynamic avatars array
    dynamicAvatars.push({
        sprite: newAvatar,
        light: light,
        id: avatarId,
        color: avatarColor,
        lastMoveTime: 0
    });
    
    // If this is the first avatar, have camera follow it
    if (dynamicAvatars.length === 1) {
        scene.cameras.main.startFollow(newAvatar, true, 0.08, 0.08);
    }
    
    // Increment color and size indices
    currentColorIndex++;
    currentSizeIndex++;
    
    // Add random movement behavior for the new avatar
    scene.time.addEvent({
        delay: Phaser.Math.Between(2000, 4000),
        callback: moveNPCRandomly,
        args: [newAvatar, "bob"],
        loop: true
    });
    
    console.log('Created new avatar:', avatarId, 'with color:', avatarColor.toString(16), 'and size:', avatarSize);
}

function handleServerEvent(data, scene) {
    const tempText = scene.add.text(0, 0, data.message, { 
        fontSize: '14px', 
        fill: textColor, 
        wordWrap: { width: 300 } 
    });

    // Calculate the dimensions of the text box based on text dimensions
    const textWidth = tempText.width;
    const textHeight = tempText.height;

    const boxWidth = textWidth + padding * 2;
    const boxHeight = textHeight + padding * 2;

    // Remove the temporary text object
    tempText.destroy();

    let targetSprite, bubbleX, bubbleY;
    
    // Handle dynamic avatars
    const dynamicAvatar = dynamicAvatars.find(avatar => avatar.id === data.from);
    if (dynamicAvatar) {
        targetSprite = dynamicAvatar.sprite;
        bubbleX = targetSprite.x - boxWidth/2;
        bubbleY = targetSprite.y - boxHeight - 20;
        
        const bubble = scene.add.graphics();
        bubble.lineStyle(borderWidth, borderColor);
        bubble.fillStyle(backgroundColor, 0.9);
        bubble.strokeRoundedRect(bubbleX, bubbleY, boxWidth, boxHeight, cornerRadius);
        bubble.fillRoundedRect(bubbleX, bubbleY, boxWidth, boxHeight, cornerRadius);
        
        const message = scene.add.text(bubbleX + padding, bubbleY + padding, data.message, { 
            fontSize: '14px', 
            fill: textColor, 
            wordWrap: { width: boxWidth - padding * 2 } 
        });
        
        const stroke = scene.add.graphics();
        stroke.lineStyle(2, dynamicAvatar.color, 1);
        stroke.beginPath();
        stroke.moveTo(bubbleX + boxWidth/2, bubbleY + boxHeight);
        stroke.lineTo(targetSprite.x, targetSprite.y - 10);
        stroke.strokePath();

        setTimeout(() => {
            if (message) message.destroy();
            if (bubble) bubble.destroy();
            if (stroke) stroke.clear();
        }, 7000);
    }
}

