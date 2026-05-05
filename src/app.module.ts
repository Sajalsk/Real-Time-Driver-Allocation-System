import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RideController } from './ride.controller';
import { DriverController } from './driver.controller';
import { RideService } from './ride.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { RideGateway } from './ride.gateway';
import { RideTimeoutProcessor } from './ride-timeout.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue({ name: 'rides-timeout' }),
  ],
  controllers: [RideController, DriverController],
  providers: [
    RideService,
    PrismaService,
    RedisService,
    RideGateway,
    RideTimeoutProcessor,
  ],
})
export class AppModule {}
