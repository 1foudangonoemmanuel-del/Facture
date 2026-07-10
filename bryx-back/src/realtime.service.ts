import { Injectable, Logger } from '@nestjs/common';
import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { AuthService, AuthenticatedUser } from './auth.service';

type RealtimeClient = WebSocket & {
    user?: AuthenticatedUser;
    alive?: boolean;
};

@Injectable()
export class RealtimeService {
    private readonly logger = new Logger(RealtimeService.name);
    private server?: WebSocketServer;
    private heartbeat?: NodeJS.Timeout;

    constructor(private readonly authService: AuthService) { }

    attach(httpServer: HttpServer) {
        if (this.server) return;

        this.server = new WebSocketServer({
            noServer: true,
            path: '/ws',
        });

        httpServer.on('upgrade', async (request, socket, head) => {
            try {
                const requestUrl = new URL(
                    request.url || '',
                    `http://${request.headers.host || 'localhost'}`,
                );

                if (requestUrl.pathname !== '/ws') return;

                const token = requestUrl.searchParams.get('token');
                if (!token) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                const user = await this.authService.verifyToken(token);

                this.server?.handleUpgrade(request, socket, head, (client) => {
                    const realtimeClient = client as RealtimeClient;
                    realtimeClient.user = user;
                    realtimeClient.alive = true;
                    this.server?.emit('connection', realtimeClient, request);
                });
            } catch {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
            }
        });

        this.server.on('connection', (client: RealtimeClient) => {
            client.on('pong', () => {
                client.alive = true;
            });

            client.send(
                JSON.stringify({
                    type: 'realtime.connected',
                    at: new Date().toISOString(),
                }),
            );
        });

        this.heartbeat = setInterval(() => {
            this.server?.clients.forEach((client) => {
                const realtimeClient = client as RealtimeClient;

                if (realtimeClient.alive === false) {
                    realtimeClient.terminate();
                    return;
                }

                realtimeClient.alive = false;
                realtimeClient.ping();
            });
        }, 30000);

        this.logger.log('Realtime WebSocket attached on /ws');
    }

    broadcast(type: string, payload: Record<string, unknown> = {}) {
        if (!this.server) return;

        const message = JSON.stringify({
            type,
            payload,
            at: new Date().toISOString(),
        });

        this.server.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    close() {
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
        }

        this.server?.close();
    }
}
