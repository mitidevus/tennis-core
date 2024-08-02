import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateOrderDto,
  RenewOrderDto,
  UpgradeOrderDto,
} from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaymentService } from 'src/services/payment/payment.service';
import { CreatePaymentUrlRequest } from 'src/proto/payment_service.pb';
import { PageOptionsOrderDto } from './dto';
import { MongoDBPrismaService } from 'src/prisma/prisma.mongo.service';
import { OrderStatus } from '@prisma/client';
import { addMonths } from 'date-fns';

@Injectable()
export class OrderService {
  constructor(
    private prismaService: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly mongodbPrismaService: MongoDBPrismaService,
  ) {}
  async create(createOrderDto: CreateOrderDto, ip: string, headers: any) {
    try {
      const packageIdentity = await this.prismaService.packages.findUnique({
        where: {
          id: createOrderDto.packageId,
        },
      });
      if (!packageIdentity) {
        throw new NotFoundException({
          message: 'Package not found',
          data: null,
        });
      }
      const data = {
        userId: createOrderDto.userId,
        groupId: createOrderDto.groupId,
        packageId: createOrderDto.packageId,
        price: packageIdentity.price,
        partner: createOrderDto.partner,
      };
      const order = await this.prismaService.orders.create({ data });
      const returnUrl = headers?.ismobile
        ? process.env.RETURN_URL_PAYMENT_FOR_MOBILE
        : process.env.RETURN_URL_PAYMENT_FOR_WEB;
      const paymentDto: CreatePaymentUrlRequest = {
        amount: order.price,
        locale: 'vi',
        orderId: order.id,
        partner: createOrderDto.partner,
        clientIp: ip,
        returnUrl: returnUrl,
      };
      const payment = await this.paymentService.createPayment(paymentDto);
      return { order, payment: payment?.data };
    } catch (error) {
      throw error;
    }
  }

  async upgrade(
    dto: UpgradeOrderDto,
    ip: string,
    headers: any,
    userId: string,
  ) {
    try {
      const purchasedPackage =
        await this.mongodbPrismaService.purchasedPackage.findUnique({
          where: {
            id: dto.purchasedPackageId,
          },
        });
      if (!purchasedPackage) {
        throw new NotFoundException({
          message: 'Purchased Package not found',
          data: null,
        });
      }
      if (purchasedPackage.userId != userId) {
        throw new BadRequestException({
          message: 'Access Denied',
          data: null,
        });
      }
      const updatedOrder = await this.prismaService.orders.findFirst({
        where: {
          id: purchasedPackage.orderId,
        },
        include: {
          package: {
            include: {
              parentPackage: true,
            },
          },
        },
      });
      if (!updatedOrder) {
        throw new NotFoundException({
          message: 'Order not found',
          data: null,
        });
      }
      const childrenPackages = await this.getAllChildren(dto.packageId);
      const childrenPackagesIds = childrenPackages.map(
        (cpackage) => cpackage.id,
      );

      if (!childrenPackagesIds.includes(updatedOrder.package.id)) {
        throw new BadRequestException({
          message: 'Cannot upgrade to this package',
          data: null,
        });
      }
      const parentPackage = await this.prismaService.packages.findFirst({
        where: {
          id: dto.packageId,
        },
      });
      const price = parentPackage.price;
      const packageId = parentPackage.id;
      const order = await this.prismaService.orders.create({
        data: {
          userId: userId,
          packageId,
          price,
          partner: dto.partner,
          type: dto.type,
          referenceId: updatedOrder.id,
        },
      });
      const returnUrl = headers?.ismobile
        ? process.env.RETURN_URL_PAYMENT_FOR_MOBILE
        : process.env.RETURN_URL_PAYMENT_FOR_WEB;
      const paymentDto: CreatePaymentUrlRequest = {
        amount: order.price,
        locale: 'vi',
        orderId: order.id,
        partner: dto.partner,
        clientIp: ip,
        returnUrl: returnUrl,
      };
      const payment = await this.paymentService.createPayment(paymentDto);
      return { order, payment: payment?.data };
    } catch (error) {
      throw error;
    }
  }

  async getAllChildren(parentId: number): Promise<any[]> {
    const result: any[] = [];
    const queue: number[] = [parentId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (currentId === undefined) continue;

      // Lấy tất cả các gói con của gói hiện tại
      const children = await this.prismaService.packages.findMany({
        where: { parentId: currentId },
      });

      // Thêm các gói con vào kết quả và vào hàng đợi
      result.push(...children);
      queue.push(...children.map((child) => child.id));
    }

    return result;
  }

  async renew(dto: RenewOrderDto, ip: string, headers: any, userId: string) {
    try {
      const purchasedPackage =
        await this.mongodbPrismaService.purchasedPackage.findUnique({
          where: {
            id: dto.purchasedPackageId,
          },
        });
      if (!purchasedPackage) {
        throw new NotFoundException({
          message: 'Purchased Package not found',
          data: null,
        });
      }
      if (purchasedPackage.userId != userId) {
        throw new BadRequestException({
          message: 'Access Denied',
          data: null,
        });
      }
      const updatedOrder = await this.prismaService.orders.findFirst({
        where: {
          id: purchasedPackage.orderId,
        },
        include: {
          package: {
            include: {
              parentPackage: true,
            },
          },
        },
      });
      if (!updatedOrder) {
        throw new NotFoundException({
          message: 'Order not found',
          data: null,
        });
      }

      // if (!updatedOrder.package.parentId && dto.type === 'upgrade') {
      //   throw new BadRequestException({
      //     message: 'This package cannot upgrade',
      //     data: null,
      //   });
      // }
      const price = updatedOrder.package.price;
      const packageId = updatedOrder.package.id;
      const order = await this.prismaService.orders.create({
        data: {
          userId: userId,
          packageId,
          price,
          partner: dto.partner,
          type: dto.type,
          referenceId: updatedOrder.id,
        },
      });
      const returnUrl = headers?.ismobile
        ? process.env.RETURN_URL_PAYMENT_FOR_MOBILE
        : process.env.RETURN_URL_PAYMENT_FOR_WEB;
      const paymentDto: CreatePaymentUrlRequest = {
        amount: order.price,
        locale: 'vi',
        orderId: order.id,
        partner: dto.partner,
        clientIp: ip,
        returnUrl: returnUrl,
      };
      const payment = await this.paymentService.createPayment(paymentDto);
      return { order, payment: payment?.data };
    } catch (error) {
      throw error;
    }
  }

  async findAll(userId: string, dto: PageOptionsOrderDto) {
    const conditions = {
      orderBy: [
        {
          createdAt: dto.order,
        },
      ],
      where: {
        userId,
        status: dto?.status,
        NOT: {
          status: 'new',
        },
      },
    };

    const pageOption =
      dto.page && dto.take
        ? {
            skip: dto.skip,
            take: dto.take,
          }
        : undefined;

    const [result, totalCount] = await Promise.all([
      this.prismaService.orders.findMany({
        include: {
          package: true,
        },
        //...conditions,
        orderBy: [
          {
            createdAt: dto.order,
          },
        ],
        where: {
          userId,
          status: dto?.status,
          NOT: {
            status: OrderStatus.new,
          },
        },
        ...pageOption,
      }),
      this.prismaService.orders.count({
        where: {
          userId,
          status: dto?.status,
          NOT: {
            status: OrderStatus.new,
          },
        },
      }),
    ]);

    return {
      data: result,
      totalPages: Math.ceil(totalCount / dto.take),
      totalCount,
    };
  }

  async findAllByAdmin(dto: PageOptionsOrderDto) {
    const conditions = {
      orderBy: [
        {
          createdAt: dto.order,
        },
      ],
      where: {
        status: dto?.status,
      },
    };

    const pageOption =
      dto.page && dto.take
        ? {
            skip: dto.skip,
            take: dto.take,
          }
        : undefined;

    const [result, totalCount] = await Promise.all([
      this.prismaService.orders.findMany({
        include: {
          package: true,
        },
        //...conditions,
        orderBy: [
          {
            createdAt: dto.order,
          },
        ],
        where: {
          status: dto?.status,
          userId: dto?.userId,
        },
        ...pageOption,
      }),
      this.prismaService.orders.count({
        where: {
          status: dto?.status,
          userId: dto?.userId,
        },
      }),
    ]);

    return {
      data: result,
      totalPages: Math.ceil(totalCount / dto.take),
      totalCount,
    };
  }

  async findOne(id: string) {
    const order = await this.prismaService.orders.findFirst({
      where: {
        id: id,
      },
      include: {
        package: true,
        user: {
          select: {
            id: true,
            email: true,
            image: true,
            name: true,
            role: true,
            phoneNumber: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException({
        message: 'Order not found',
        data: null,
      });
    }
    return order;
  }

  async update(id: string, updateOrderDto: UpdateOrderDto) {
    try {
      const order = await this.prismaService.orders.update({
        where: {
          id: id,
        },
        data: {
          status: updateOrderDto.status,
        },
      });
      if (!order) {
        throw new NotFoundException({
          message: 'Order not found',
          data: null,
        });
      }
      return {
        ...order,
      };
    } catch (error) {
      throw new InternalServerErrorException({
        message: error.message,
        data: null,
      });
    }
  }

  async updateFromPaymentService(id: string, updateOrderDto: UpdateOrderDto) {
    try {
      const order = await this.prismaService.orders.findFirst({
        where: {
          id: id,
        },
        include: {
          package: true,
        },
      });
      if (!order) {
        throw new NotFoundException({
          message: 'Order not found',
          data: null,
        });
      }
      if (
        order.type === 'renew' &&
        updateOrderDto.status == OrderStatus.completed
      ) {
        const purchasedPackage =
          await this.mongodbPrismaService.purchasedPackage.findFirst({
            where: {
              orderId: order.referenceId,
            },
          });
        if (!purchasedPackage) {
          throw new NotFoundException({
            message: 'Purchased Package not found',
            data: null,
          });
        }
        await this.mongodbPrismaService.purchasedPackage.updateMany({
          where: {
            orderId: order.referenceId,
          },
          data: {
            orderId: order.id,
            endDate: addMonths(
              purchasedPackage.endDate,
              order.package.duration,
            ),
          },
        });
      }
      if (
        updateOrderDto.status == OrderStatus.completed &&
        order.type === 'create'
      ) {
        const packageWithService = await this.prismaService.packages.findFirst({
          where: { id: order.packageId },
          include: {
            packageServices: {
              include: {
                service: true,
              },
            },
          },
        });
        const services = packageWithService.packageServices.map((value) => {
          const serviceConfig = JSON.parse(value.service.config);
          serviceConfig.used = 0;
          value.service.config = JSON.stringify(serviceConfig);
          return value.service;
        });

        await this.mongodbPrismaService.purchasedPackage.create({
          data: {
            expired: false,
            orderId: order.id,
            endDate: addMonths(Date.now(), packageWithService.duration),
            userId: order.userId,
            package: {
              id: packageWithService.id,
              name: packageWithService.name,
              price: packageWithService.price,
              duration: packageWithService.duration,
              images: packageWithService.images,
              createdAt: packageWithService.createdAt,
              updatedAt: packageWithService.updatedAt,
              services: services,
            },
          },
        });
      }

      if (
        updateOrderDto.status == OrderStatus.completed &&
        order.type === 'upgrade'
      ) {
        const purchasedPackage =
          await this.mongodbPrismaService.purchasedPackage.findFirst({
            where: {
              orderId: order.referenceId,
            },
          });
        if (!purchasedPackage) {
          throw new NotFoundException({
            message: 'Purchased Package not found',
            data: null,
          });
        }
        const packageWithService = await this.prismaService.packages.findFirst({
          where: { id: order.packageId },
          include: {
            packageServices: {
              include: {
                service: true,
              },
            },
            parentPackage: {
              include: {
                packageServices: {
                  include: {
                    service: true,
                  },
                },
              },
            },
          },
        });
        const services = packageWithService.packageServices.map((value) => {
          const serviceConfig = JSON.parse(value.service.config);
          serviceConfig.used = 0;
          value.service.config = JSON.stringify(serviceConfig);
          return value.service;
        });

        await this.mongodbPrismaService.purchasedPackage.updateMany({
          where: {
            orderId: order.referenceId,
          },
          data: {
            expired: false,
            endDate: addMonths(
              purchasedPackage.endDate,
              packageWithService.duration,
            ),
            userId: order.userId,
            orderId: order.id,
            package: {
              id: packageWithService.id,
              name: packageWithService.name,
              price: packageWithService.price,
              duration: packageWithService.duration,
              images: packageWithService.images,
              createdAt: packageWithService.createdAt,
              updatedAt: packageWithService.updatedAt,
              services: services,
            },
          },
        });
      }
      const updatedOrder = await this.prismaService.orders.update({
        where: {
          id: id,
        },
        data: {
          status: updateOrderDto.status,
        },
      });
      return {
        ...updatedOrder,
      };
    } catch (error) {
      throw new InternalServerErrorException({
        message: error.message,
        data: null,
      });
    }
  }

  async remove(id: string) {
    const order = await this.prismaService.orders.delete({
      where: {
        id: id,
      },
    });
    if (!order) {
      throw new NotFoundException({
        message: 'Order not found',
        data: null,
      });
    }
  }
}
