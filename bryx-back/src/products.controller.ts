import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('api/products')
export class ProductsController {
    constructor(private readonly productsService: ProductsService) { }

    @Get()
    findAll() {
        return this.productsService.findAll();
    }

    @Post()
    create(
        @Body()
        body: {
            name: string;
            price: number;
            category?: string;
            actorUserId?: number;
        },
    ) {
        return this.productsService.create(body);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            price?: number;
            category?: string | null;
            active?: boolean;
            actorUserId?: number;
        },
    ) {
        return this.productsService.update(Number(id), body);
    }

    @Patch(':id/disable')
    disable(@Param('id') id: string, @Body() body: { actorUserId?: number }) {
        return this.productsService.disable(Number(id), body.actorUserId);
    }
}