import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { kafkaConfig } from '@chainstrike/config';

@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'KAFKA_PRODUCER',
        transport: Transport.KAFKA,
        options: {
          client: {
            brokers: kafkaConfig('compliance').brokers,
            clientId: kafkaConfig('compliance').clientId,
          },
        },
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class KafkaProducerModule {}
