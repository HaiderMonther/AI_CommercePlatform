import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter with the API's CORS policy and, when Redis is reachable, the Redis
 * adapter: an event emitted by one API instance then reaches sockets connected to any
 * other instance behind the load balancer. Without it, horizontal scaling would silently
 * deliver each message to roughly 1/N of the connected agents.
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RealtimeIoAdapter.name);
  private redisAdapter: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  /**
   * Returns false when Redis is unreachable. A single instance still works in that case,
   * so the caller logs and carries on rather than refusing to boot.
   */
  async connectToRedis(url: string): Promise<boolean> {
    const publisher = new Redis(url, { lazyConnect: true, connectTimeout: 5000 });
    const subscriber = publisher.duplicate();

    // Without a listener ioredis reports every reconnect attempt as an unhandled error.
    // After startup it reconnects on its own; a blip only delays cross-instance events.
    for (const client of [publisher, subscriber]) {
      client.on('error', (error: Error) => {
        this.logger.warn(`Realtime Redis connection error: ${error.message}`);
      });
    }

    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
    } catch (error) {
      publisher.disconnect();
      subscriber.disconnect();
      this.logger.warn(
        `Redis unavailable for realtime fan-out (${error instanceof Error ? error.message : String(error)}); ` +
          'events will only reach sockets on this instance',
      );
      return false;
    }

    this.clients = [publisher, subscriber];
    this.redisAdapter = createAdapter(publisher, subscriber);
    return true;
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    }) as Server;

    if (this.redisAdapter) {
      server.adapter(this.redisAdapter);
    }

    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.allSettled(this.clients.map((client) => client.quit()));
  }
}
