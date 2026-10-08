import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RealtimeIoAdapter } from '@modules/realtime/realtime-io.adapter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const port = config.getOrThrow<number>('app.port');
  const apiPrefix = config.getOrThrow<string>('app.apiPrefix');
  const corsOrigins = config.getOrThrow<string[]>('app.corsOrigins');
  const swaggerEnabled = config.get<boolean>('app.swaggerEnabled');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
  });

  const realtimeAdapter = new RealtimeIoAdapter(app, corsOrigins);
  await realtimeAdapter.connectToRedis(config.getOrThrow<string>('redis.url'));
  app.useWebSocketAdapter(realtimeAdapter);

  app.setGlobalPrefix(apiPrefix, { exclude: ['health', 'health/live'] });
  app.enableShutdownHooks();

  if (swaggerEnabled) {
    const documentConfig = new DocumentBuilder()
      .setTitle('AI Commerce Platform API')
      .setDescription(
        'واجهة برمجة التطبيقات لمنصة إدارة المبيعات عبر واتساب وإنستغرام وفيسبوك بالذكاء الاصطناعي',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .addTag('Auth', 'المصادقة وإدارة الجلسات')
      .addTag('Companies', 'بيانات الشركة')
      .addTag('Users', 'المستخدمون')
      .addTag('Roles', 'الأدوار')
      .addTag('Permissions', 'الصلاحيات')
      .addTag('Products', 'المنتجات والمتغيرات')
      .addTag('Categories', 'التصنيفات')
      .addTag('Inventory', 'حركة المخزون')
      .addTag('Customers', 'الزبائن')
      .addTag('Conversations', 'المحادثات')
      .addTag('Messages', 'رسائل المحادثات')
      .addTag('Audit', 'سجل العمليات')
      .addTag('Health', 'فحص الخدمة')
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on http://localhost:${port}/${apiPrefix}`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs on http://localhost:${port}/${apiPrefix}/docs`);
  }
}

void bootstrap();
