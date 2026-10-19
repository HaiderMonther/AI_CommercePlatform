import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { parseTrustProxy } from './configuration';
import { AuthRateLimit, throttlerOptions } from './throttle';

@Controller()
class ProbeController {
  @Get('orders')
  orders() {
    return 'ok';
  }

  @Get('login')
  @AuthRateLimit()
  login() {
    return 'ok';
  }
}

describe('rate limits', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const config = {
      get: (key: string) =>
        ({ 'throttle.limit': 50, 'throttle.ttlSeconds': 60, 'throttle.authLimit': 3 })[key],
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerOptions(config))],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('does not apply the sign-in limit to ordinary routes', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).get('/orders').expect(200);
    }
  });

  it('applies the sign-in limit to routes that opt in', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer()).get('/login').expect(200);
    }
    await request(app.getHttpServer()).get('/login').expect(429);
  });
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['true', true],
    ['1', 1],
    ['10.0.0.0/8, 172.16.0.0/12', '10.0.0.0/8, 172.16.0.0/12'],
  ])('%j → %j', (input, expected) => {
    expect(parseTrustProxy(input)).toEqual(expected);
  });
});
