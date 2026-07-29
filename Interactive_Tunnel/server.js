// `const express = require('express');
// const path = require('path');
// const WebSocket = require('ws');
// const { SerialPort } = require('serialport'); 

// // --- 1920x1080 Testing Configuration ---
// const SCREEN_WIDTH = 1920;
// const SCREEN_HEIGHT = 1080;
// const TEST_ZONE_MM = 2000; // 2 meters max distance for desk testing
// const TARGET_COM_PORT = 'COM6'; 
// const BAUD_RATE = 256000; 

// // --- 1. Merged Server Setup (Port 3000) ---
// const app = express();
// app.use(express.static(__dirname));
// app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// const server = app.listen(3000, () => {
//     console.log("🌐 Frontend web page running at http://localhost:3000");
// });

// const wss = new WebSocket.Server({ server }); // Attached directly to Port 3000
// let clients = [];
// wss.on('connection', (ws) => {
//     clients.push(ws);
//     ws.on('close', () => clients = clients.filter(c => c !== ws));
// });

// // --- 2. Hardware Initialization & Native Parsing ---
// const lidarPort = new SerialPort({ path: TARGET_COM_PORT, baudRate: BAUD_RATE, autoOpen: false }); 
// let buffer = Buffer.alloc(0); 
// let activeCells = new Map();

// lidarPort.on('data', (data) => {
//     buffer = Buffer.concat([buffer, data]); 
    
//     while (buffer.length >= 5) {
//         const syncByte1 = buffer[0]; 
//         const syncByte2 = buffer[1]; 
        
//         if ((syncByte1 & 0x01) !== ((syncByte1 >> 1) & 0x01) && (syncByte2 & 0x01) === 1) { 
//             const angle = ((buffer[1] >> 1) | (buffer[2] << 7)) / 64.0; 
//             const distance = (buffer[3] | (buffer[4] << 8)) / 4.0; 

//             // Test logic: Track objects within 2 meters
//             if (distance > 0 && distance < TEST_ZONE_MM) { 
//                 const angleRad = angle * (Math.PI / 180);
                
//                 // Raw physical coordinates (Sensor sits at the bottom-center of the screen)
//                 const rawX = distance * Math.cos(angleRad);
//                 const rawY = distance * Math.sin(angleRad);

//                 // Map 2000mm physical space directly to 1920x1080 absolute pixels
//                 const pixelX = Math.round((SCREEN_WIDTH / 2) + ((rawX / TEST_ZONE_MM) * SCREEN_WIDTH));
//                 const pixelY = Math.round(SCREEN_HEIGHT - ((rawY / TEST_ZONE_MM) * SCREEN_HEIGHT));

//                 // Basic Debouncer (150px grid)
//                 const gridKey = `${Math.floor(pixelX/150)}-${Math.floor(pixelY/150)}`;
//                 const now = Date.now();
//                 if (!activeCells.has(gridKey) || (now - activeCells.get(gridKey)) > 300) {
//                     activeCells.set(gridKey, now);
//                     console.log(`👣 Ripple Spawned at -> X: ${pixelX}px | Y: ${pixelY}px`);
                    
//                     const payload = JSON.stringify({ pixelX, pixelY });
//                     clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
//                 }
//             }
//             buffer = buffer.slice(5); 
//         } else {
//             buffer = buffer.slice(1); 
//         }
//     }
// });

// // Boot the hardware using the proven hex sequence
// lidarPort.open((err) => {
//     if (err) return console.error('Error opening Lidar port: ', err.message); 
//     console.log(`🔌 Lidar hardware connected on ${TARGET_COM_PORT}`); 
    
//     lidarPort.write(Buffer.from([0xA5, 0x25])); 
//     setTimeout(() => {
//         lidarPort.write(Buffer.from([0xA5, 0x40])); 
//         setTimeout(() => {
//             lidarPort.set({ dtr: false }, (err) => { if (err) console.error(err); }); 
//             lidarPort.write(Buffer.from([0xA5, 0xF0, 0x02, 0x94, 0x02, 0xC1])); 
//             setTimeout(() => {
//                 buffer = Buffer.alloc(0); 
//                 lidarPort.write(Buffer.from([0xA5, 0x20])); 
//                 console.log('🚀 Laser firing! Wave your hand.'); 
//             }, 1000); 
//         }, 2000); 
//     }, 100); 
// });

// process.on('SIGINT', () => {
//     lidarPort.write(Buffer.from([0xA5, 0x25]), () => { 
//         lidarPort.write(Buffer.from([0xA5, 0xF0, 0x02, 0x00, 0x00, 0x57]), () => { 
//             lidarPort.close(); process.exit(); 
//         });
//     });
// });

// 2 Sensors
const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const { SerialPort } = require('serialport'); // Using native serialport 

// --- Installation Configuration ---
const TUNNEL_WIDTH_MM = 3000;  // 3 meters
const TUNNEL_LENGTH_MM = 12000; // 12 meters
const GRID_RESOLUTION = 150;    // 15cm debounce grid 
const STEP_DELAY_MS = 1000;     // 1-second delay for walking pace 

// --- Hardware Configuration ---
const BAUD_RATE = 256000; 
const PORT_RIGHT = 'COM3'; // Sensor 1: Right wall (3m mark)
const PORT_LEFT = 'COM4';  // Sensor 2: Left wall (9m mark)

// --- 1. Merged Server Setup (Port 3000) ---
const app = express();
app.use(express.static(__dirname)); 
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html'))); 

const server = app.listen(3000, () => {
    console.log("🌐 Frontend web page running at http://localhost:3000"); 
});

const wss = new WebSocket.Server({ server }); 
let clients = [];
wss.on('connection', (ws) => {
    clients.push(ws); 
    ws.on('close', () => clients = clients.filter(c => c !== ws)); 
});

// --- 2. Spatial Debouncer & Delay Logic ---
let activeCells = new Map(); 

function processFootstep(x, y) {
    const gridX = Math.floor(x / GRID_RESOLUTION); 
    const gridY = Math.floor(y / GRID_RESOLUTION); 
    const gridKey = `${gridX}-${gridY}`; 
    const now = Date.now(); 

    // Block rapid duplicate hits in the same 15cm area
    if (!activeCells.has(gridKey) || (now - activeCells.get(gridKey)) > 300) { 
        activeCells.set(gridKey, now); 
        console.log(`👣 Valid Step Detected -> X: ${Math.round(x)}mm | Y: ${Math.round(y)}mm`); 
        
        setTimeout(() => {
            // Convert absolute millimeters to screen percentages
            const payload = JSON.stringify({ 
                percentX: (x / TUNNEL_WIDTH_MM) * 100, 
                percentY: (y / TUNNEL_LENGTH_MM) * 100 
            });
            
            clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); }); 
        }, STEP_DELAY_MS); 
    }
}

// --- 3. Hardware Initialization & Native Parsing ---
function startLidar(portName, originX, originY, isRightWall) {
    const lidarPort = new SerialPort({ path: portName, baudRate: BAUD_RATE, autoOpen: false }); 
    let buffer = Buffer.alloc(0); 

    lidarPort.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]); 
        
        while (buffer.length >= 5) { 
            const syncByte1 = buffer[0]; 
            const syncByte2 = buffer[1]; 
            
            if ((syncByte1 & 0x01) !== ((syncByte1 >> 1) & 0x01) && (syncByte2 & 0x01) === 1) { 
                const angle = ((buffer[1] >> 1) | (buffer[2] << 7)) / 64.0; 
                const distance = (buffer[3] | (buffer[4] << 8)) / 4.0; 

                // Drop noise and hits beyond 8 meters (sensors only need to see halfway + overlap)
                if (distance > 0 && distance < 8000) { 
                    const angleRad = angle * (Math.PI / 180);
                    let x, y;

                    // Math transformation based on physical sensor mounting
                    if (isRightWall) {
                        x = originX - (distance * Math.cos(angleRad));
                        y = originY + (distance * Math.sin(angleRad));
                    } else {
                        x = originX + (distance * Math.cos(angleRad));
                        y = originY - (distance * Math.sin(angleRad));
                    }

                    // Strict Tunnel Bounding Box (3000x12000)
                    if (x >= 0 && x <= TUNNEL_WIDTH_MM && y >= 0 && y <= TUNNEL_LENGTH_MM) {
                        processFootstep(x, y);
                    }
                }
                buffer = buffer.slice(5); 
            } else {
                buffer = buffer.slice(1); 
            }
        }
    });

    // Boot hardware using proven hex sequence
    lidarPort.open((err) => {
        if (err) return console.error(`Error on ${portName}:`, err.message); 
        console.log(`🔌 ${portName} Connected.`); 
        
        lidarPort.write(Buffer.from([0xA5, 0x25])); 
        setTimeout(() => {
            lidarPort.write(Buffer.from([0xA5, 0x40])); 
            setTimeout(() => {
                lidarPort.set({ dtr: false }, () => {}); 
                lidarPort.write(Buffer.from([0xA5, 0xF0, 0x02, 0x94, 0x02, 0xC1])); 
                setTimeout(() => {
                    buffer = Buffer.alloc(0); 
                    lidarPort.write(Buffer.from([0xA5, 0x20])); 
                    console.log(`🚀 ${portName} Laser firing!`); 
                }, 1000); 
            }, 2000); 
        }, 100); 
    });

    process.on('SIGINT', () => {
        lidarPort.write(Buffer.from([0xA5, 0x25]), () => { 
            lidarPort.write(Buffer.from([0xA5, 0xF0, 0x02, 0x00, 0x00, 0x57]), () => { 
                lidarPort.close(); 
            });
        });
    });
}

// Sensor 1: Right wall, 3-meter mark -> Origin (3000, 3000)
startLidar(PORT_RIGHT, TUNNEL_WIDTH_MM, 3000, true);

// Sensor 2: Left wall, 9-meter mark -> Origin (0, 9000)
startLidar(PORT_LEFT, 0, 9000, false);