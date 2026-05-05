import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class RideGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RideGateway.name);

  // Map of driverId → socketId for targeted push notifications
  private driverSockets = new Map<string, string>();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    // Remove disconnected driver from the map
    for (const [driverId, socketId] of this.driverSockets.entries()) {
      if (socketId === client.id) {
        this.driverSockets.delete(driverId);
        this.logger.log(`Driver ${driverId} disconnected`);
        break;
      }
    }
  }

  /**
   * Drivers call this after connecting to register their identity.
   * Client sends: socket.emit('register-driver', { driverId: '...' })
   */
  @SubscribeMessage('register-driver')
  handleRegisterDriver(client: Socket, payload: { driverId: string }) {
    this.driverSockets.set(payload.driverId, client.id);
    this.logger.log(
      `Driver ${payload.driverId} registered on socket ${client.id}`,
    );
    return { event: 'registered', data: { success: true } };
  }

  /**
   * Push a new ride request to specific nearby drivers.
   * Called internally by RideService when a ride is created.
   */
  notifyDrivers(
    driverIds: string[],
    rideData: { rideId: string; lat: number; lng: number },
  ) {
    let notified = 0;

    for (const driverId of driverIds) {
      const socketId = this.driverSockets.get(driverId);
      if (socketId) {
        this.server.to(socketId).emit('ride-request', rideData);
        notified++;
      }
    }

    this.logger.log(
      `Notified ${notified}/${driverIds.length} drivers via WebSocket for ride ${rideData.rideId}`,
    );

    return notified;
  }

  /**
   * Broadcast ride assignment result to all drivers who were notified.
   * Tells non-winning drivers "this ride is no longer available."
   */
  notifyRideAssigned(
    rideId: string,
    winningDriverId: string,
    allDriverIds: string[],
  ) {
    for (const driverId of allDriverIds) {
      const socketId = this.driverSockets.get(driverId);
      if (socketId) {
        this.server.to(socketId).emit('ride-assigned', {
          rideId,
          assignedTo: winningDriverId,
          yourResult: driverId === winningDriverId ? 'YOU_WON' : 'RIDE_TAKEN',
        });
      }
    }
  }
}
