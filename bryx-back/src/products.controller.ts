import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.guard';
import { ProductsService } from './products.service';

@Controller('api/products')
export class ProductsController {
    constructor(private readonly productsService: ProductsService) { }

    @Get()
    findAll() {
        return this.productsService.findAll();
    }

    @Post()
    @Roles('ADMIN', 'MANAGER')
    create(
        @Req() request: AuthenticatedRequest,
        @Body()
        body: {
            name: string;
            price: number;
            category?: string;
        },
    ) {
        return this.productsService.create({
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id')
    @Roles('ADMIN', 'MANAGER')
    update(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            price?: number;
            category?: string | null;
            active?: boolean;
        },
    ) {
        return this.productsService.update(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/disable')
    @Roles('ADMIN', 'MANAGER')
    disable(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
        return this.productsService.disable(Number(id), request.user.id);
    }
}
