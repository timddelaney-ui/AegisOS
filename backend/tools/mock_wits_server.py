"""
Mock WITS 0 TCP server — produces a sample every 1s on port 12399.
Used to verify the real WITS 0 listener parses and ingests correctly.
"""
import asyncio
import random
import time

PORT = 12399

async def serve_wits(reader, writer):
    print(f"client connected: {writer.get_extra_info('peername')}")
    try:
        depth = 1000.0
        pres = 4000.0
        wt = 15000.0
        while True:
            depth += 10
            pres = 4000 + 2000 * random.random()
            wt = 15000 + 3000 * random.random()
            # WITS 0 frame: &&\n0108 depth\n0111 wt\n0112 pres\n!!\n
            lines = [
                "&&\r\n",
                f"0108 {depth:.2f}\r\n",
                f"0111 {wt:.1f}\r\n",
                f"0112 {pres:.1f}\r\n",
                "!!\r\n",
            ]
            for line in lines:
                writer.write(line.encode())
            await writer.drain()
            await asyncio.sleep(1.0)
    except Exception as e:
        print(f"client gone: {e}")
    finally:
        writer.close()

async def main():
    server = await asyncio.start_server(serve_wits, "127.0.0.1", PORT)
    print(f"Mock WITS 0 server listening on 127.0.0.1:{PORT}")
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    asyncio.run(main())
