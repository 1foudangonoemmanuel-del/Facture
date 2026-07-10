import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RealtimeService } from './realtime.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.set('trust proxy', 1);

  app.use((req, res, next) => {
    const forceHttps =
      process.env.BRYX_FORCE_HTTPS === 'true' ||
      process.env.NODE_ENV === 'production';
    const forwardedProto = req.headers['x-forwarded-proto'];
    const isSecure =
      req.secure ||
      forwardedProto === 'https' ||
      (Array.isArray(forwardedProto) && forwardedProto.includes('https'));

    if (forceHttps && !isSecure) {
      if (req.method === 'GET') {
        return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
      }

      return res
        .status(426)
        .json({ message: 'HTTPS obligatoire en production' });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (isSecure) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=15552000; includeSubDomains',
      );
    }

    next();
  });

  const allowedOrigins = (process.env.BRYX_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');

  const realtimeService = app.get(RealtimeService);
  realtimeService.attach(app.getHttpServer());
}

bootstrap();
