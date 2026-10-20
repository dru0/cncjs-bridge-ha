#!/usr/bin/env python3
"""WS2812 on SPI0 MOSI (BCM GPIO10), 3 pixels, no root required with spi group."""
import sys, time
import spidev
COLORS = {'off':(0,0,0),'idle':(4,4,4),'running':(0,35,0),'paused':(40,25,0),'finished':(0,0,40),'error':(45,0,0)}

def send(color):
    # WS2812 bit 0 => 100, bit 1 => 110 at SPI 2.4 MHz.
    encoded = bytearray()
    for _ in range(3):
        r,g,b = color
        bits = 0
        for byte in (g,r,b):
            for shift in range(7,-1,-1):
                bits = (bits << 3) | (0b110 if (byte >> shift)&1 else 0b100)
        encoded.extend(bits.to_bytes(9,'big'))
    spi = spidev.SpiDev()
    spi.open(0,0)
    spi.max_speed_hz = 2400000
    spi.mode = 0
    try:
        spi.xfer2(list(encoded))
        time.sleep(0.001)
    finally:
        spi.close()

if __name__ == '__main__':
    state = sys.argv[1] if len(sys.argv)>1 else 'off'
    if state not in COLORS:
        sys.exit('Unknown state: '+state)
    send(COLORS[state])
