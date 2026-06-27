import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('api/users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    findAll() {
        return this.usersService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(Number(id));
    }

    @Post()
    create(
        @Body()
        body: {
            name: string;
            pin?: string;
            role?: string;
            actorUserId?: number;
        },
    ) {
        return this.usersService.create(body);
    }

    @Patch(':id/role')
    updateRole(
        @Param('id') id: string,
        @Body()
        body: {
            role: string;
            actorUserId?: number;
        },
    ) {
        return this.usersService.updateRole(Number(id), body);
    }

    @Patch(':id/block')
    blockUser(
        @Param('id') id: string,
        @Body() body: { actorUserId?: number },
    ) {
        return this.usersService.blockUser(Number(id), body.actorUserId);
    }

    @Patch(':id/unblock')
    unblockUser(
        @Param('id') id: string,
        @Body() body: { actorUserId?: number },
    ) {
        return this.usersService.unblockUser(Number(id), body.actorUserId);
    }

    @Delete(':id')
    deleteUser(
        @Param('id') id: string,
        @Body() body: { actorUserId?: number },
    ) {
        return this.usersService.deleteUser(Number(id), body.actorUserId);
    }
}