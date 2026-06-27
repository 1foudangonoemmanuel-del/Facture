import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ItemsService } from './items.service';

@Controller()
export class ItemsController {
    constructor(private readonly itemsService: ItemsService) { }

    @Post('api/invoices/:invoiceId/items')
    create(
        @Param('invoiceId') invoiceId: string,
        @Body()
        body: {
            productId?: number;
            name?: string;
            quantity?: number;
            unitPrice?: number;
            addedByUserId?: number;
            actorUserId?: number;
        },
    ) {
        return this.itemsService.create(Number(invoiceId), body);
    }

    @Patch('api/items/:id')
    update(
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            quantity?: number;
            unitPrice?: number;
            updatedByUserId?: number;
            actorUserId?: number;
        },
    ) {
        return this.itemsService.update(Number(id), body);
    }

    @Delete('api/items/:id')
    remove(@Param('id') id: string, @Body() body: { actorUserId?: number }) {
        return this.itemsService.remove(Number(id), body.actorUserId);
    }
}