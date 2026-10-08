import { Global, Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/** Global so any business module can publish events without importing the gateway. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
