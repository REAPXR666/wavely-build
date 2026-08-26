import discord
from discord import app_commands
from discord.ext import commands
import logging
import os
import asyncio
import time
import database

logger = logging.getLogger('WavelyBot.Tickets')

class TicketOpenButton(discord.ui.Button):
    def __init__(self, role_id: int):
        super().__init__(
            label="Open Support Ticket",
            style=discord.ButtonStyle.primary,
            custom_id="wavely_ticket_open",
            emoji="📩"
        )
        self.role_id = role_id

    async def callback(self, interaction: discord.Interaction):
        await tickets_open_logic(interaction, self.role_id)


class TicketOpenView(discord.ui.View):
    def __init__(self, role_id: int):
        super().__init__(timeout=None)
        self.add_item(TicketOpenButton(role_id))


class TicketControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Claim Ticket", style=discord.ButtonStyle.success, custom_id="wavely_ticket_claim", emoji="🙋")
    async def claim_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Only staff should claim tickets (has manage_channels or Administrator)
        if not (interaction.user.guild_permissions.manage_channels or interaction.user.guild_permissions.administrator):
            await interaction.response.send_message("❌ Only staff members can claim tickets.", ephemeral=True)
            return

        ticket_data = database.get_ticket(interaction.channel.id)
        if not ticket_data:
            await interaction.response.send_message("❌ This channel is not registered as a ticket in the database.", ephemeral=True)
            return

        if ticket_data['claimed_by']:
            claimant = interaction.guild.get_member(ticket_data['claimed_by'])
            claimant_mention = claimant.mention if claimant else "another staff member"
            await interaction.response.send_message(f"⚠️ This ticket has already been claimed by {claimant_mention}.", ephemeral=True)
            return

        # Claim the ticket
        database.claim_ticket(interaction.channel.id, interaction.user.id)
        
        # Send confirmation and disable claim button
        await interaction.response.send_message(f"🙋 **Ticket Claimed!**\n{interaction.user.mention} will assist you now.", ephemeral=False)
        
        # Disable the claim button on the message
        button.disabled = True
        await interaction.message.edit(view=self)

    @discord.ui.button(label="Close Ticket", style=discord.ButtonStyle.danger, custom_id="wavely_ticket_close", emoji="🔒")
    async def close_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        ticket_data = database.get_ticket(interaction.channel.id)
        if not ticket_data:
            await interaction.response.send_message("❌ This channel is not registered as a ticket in the database.", ephemeral=True)
            return

        if ticket_data['status'] == 'closed':
            await interaction.response.send_message("⚠️ This ticket is already closed.", ephemeral=True)
            return

        # Confirm closing
        await interaction.response.send_message("🔒 **Closing Ticket...**\nArchiving conversation and removing member permissions.", ephemeral=False)
        
        # Close in database
        database.close_ticket(interaction.channel.id)
        
        # Get ticket owner
        owner = interaction.guild.get_member(ticket_data['user_id'])
        
        # Remove owner's view permission
        if owner:
            try:
                await interaction.channel.set_permissions(owner, overwrite=None, reason="Ticket closed")
            except Exception as e:
                logger.error(f"Failed to remove permissions for {owner.name}: {e}")

        # Rename channel
        try:
            new_name = f"closed-{interaction.channel.name.replace('ticket-', '')}"
            await interaction.channel.edit(name=new_name, reason="Ticket closed")
        except Exception as e:
            logger.error(f"Failed to rename ticket channel: {e}")

        # Disable all buttons
        for child in self.children:
            child.disabled = True
        await interaction.message.edit(view=self)
        
        # Send closed embed with option to delete
        closed_embed = discord.Embed(
            title="🔒 Ticket Closed",
            description=(
                f"Ticket closed by {interaction.user.mention}.\n"
                f"Staff can delete this channel using the command `/ticket delete`."
            ),
            color=discord.Color.red()
        )
        await interaction.channel.send(embed=closed_embed)


async def tickets_open_logic(interaction: discord.Interaction, role_id: int):
    # Enforce role ID 1506425502313877554 to use the command/button
    role = interaction.guild.get_role(role_id)
    if not role or role not in interaction.user.roles:
        await interaction.response.send_message(
            "❌ **Access Denied!**\nYou must be verified (have the download/access role) to open a ticket.",
            ephemeral=True
        )
        return

    # Check if user already has an open ticket
    existing_ticket_id = database.get_user_open_ticket(interaction.user.id, interaction.guild.id)
    if existing_ticket_id:
        existing_channel = interaction.guild.get_channel(existing_ticket_id)
        if existing_channel:
            await interaction.response.send_message(
                f"⚠️ You already have an open ticket in {existing_channel.mention}!",
                ephemeral=True
            )
            return

    await interaction.response.defer(ephemeral=True)

    # Find or create Category
    category_name = "Wavely Tickets"
    category = discord.utils.get(interaction.guild.categories, name=category_name)
    if not category:
        try:
            category = await interaction.guild.create_category(
                category_name,
                reason="Auto-created by Wavely Tickets Cog"
            )
        except discord.Forbidden:
            await interaction.followup.send("❌ Error: I do not have permission to create categories.", ephemeral=True)
            return

    # Define channel overrides
    overwrites = {
        interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False),
        interaction.user: discord.PermissionOverwrite(
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            attach_files=True,
            embed_links=True
        ),
        interaction.guild.me: discord.PermissionOverwrite(
            view_channel=True,
            send_messages=True,
            manage_channels=True,
            manage_permissions=True,
            read_message_history=True
        )
    }
    
    # Give view permissions to roles that have manage_channels
    for r in interaction.guild.roles:
        if r.permissions.manage_channels or r.permissions.administrator:
            overwrites[r] = discord.PermissionOverwrite(
                view_channel=True,
                send_messages=True,
                read_message_history=True
            )

    # Create ticket channel
    channel_name = f"ticket-{interaction.user.name}"
    try:
        ticket_channel = await interaction.guild.create_text_channel(
            name=channel_name,
            category=category,
            overwrites=overwrites,
            reason=f"Ticket opened by {interaction.user.name}"
        )
    except discord.Forbidden:
        await interaction.followup.send("❌ Error: I do not have permission to create channels.", ephemeral=True)
        return

    # Log in SQLite database
    database.create_ticket(ticket_channel.id, interaction.user.id, interaction.guild.id)

    # Send Welcome Embed in the ticket channel
    embed = discord.Embed(
        title=f"🎫 Wavely Support - Ticket #{ticket_channel.name.split('-')[-1]}",
        description=(
            f"Welcome {interaction.user.mention} to your support channel.\n\n"
            "Please describe the issue you are experiencing or the assistance you need. "
            "Our staff has been notified and will be with you shortly.\n\n"
            "**Staff Actions:**\n"
            "• Click **Claim Ticket** to take ownership of this ticket.\n"
            "• Click **Close Ticket** to close the ticket and archive the channel."
        ),
        color=discord.Color.from_str("#7a22ff")
    )
    embed.set_footer(text="Wavely Helpdesk")
    
    view = TicketControlView()
    await ticket_channel.send(embed=embed, view=view)
    
    # Confirm ticket creation to user
    await interaction.followup.send(f"✅ Ticket channel created successfully! Go to {ticket_channel.mention}.", ephemeral=True)
    logger.info(f"Ticket channel created: {ticket_channel.name} ({ticket_channel.id}) for user {interaction.user.name}")


class Tickets(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        role_id_raw = os.getenv("VERIFY_ROLE_ID")
        self.verify_role_id = int(role_id_raw) if role_id_raw else 1506425502313877554

    async def cog_load(self):
        # Register persistent views
        self.bot.add_view(TicketOpenView(self.verify_role_id))
        self.bot.add_view(TicketControlView())
        logger.info("Ticket persistent views registered.")

    # Ticket setup command (restricted to staff)
    @app_commands.command(name="ticket_setup", description="Deploy the persistent ticket opening panel.")
    @app_commands.default_permissions(manage_channels=True)
    async def ticket_setup(self, interaction: discord.Interaction):
        # Check permissions
        if not (interaction.user.guild_permissions.manage_channels or interaction.user.guild_permissions.administrator):
            await interaction.response.send_message("❌ You do not have permissions to run this command.", ephemeral=True)
            return

        embed = discord.Embed(
            title="🎫 Wavely Support Center",
            description=(
                "Need assistance or have questions about the download?\n"
                "Click the button below to open a private support ticket.\n\n"
                "**Before opening a ticket:**\n"
                "• Check the server announcements first.\n"
                "• Verify you have followed all instructions correctly.\n"
                "• Be patient, our team will respond as soon as possible.\n\n"
                "*(Note: You must be verified to open a support ticket)*"
            ),
            color=discord.Color.from_str("#7a22ff")
        )
        embed.set_footer(text="Wavely Helpdesk System")
        if interaction.guild.icon:
            embed.set_thumbnail(url=interaction.guild.icon.url)

        view = TicketOpenView(self.verify_role_id)
        await interaction.channel.send(embed=embed, view=view)
        await interaction.response.send_message("✅ Ticket panel deployed successfully!", ephemeral=True)
        logger.info(f"Ticket panel deployed in {interaction.channel.name} by {interaction.user.name}")

    # Ticket open slash command for users who prefer slash commands
    @app_commands.command(name="ticket_open", description="Open a private support ticket.")
    async def ticket_open(self, interaction: discord.Interaction):
        await tickets_open_logic(interaction, self.verify_role_id)

    # Delete ticket command (staff only)
    @app_commands.command(name="ticket_delete", description="Permanently delete a closed ticket channel.")
    @app_commands.default_permissions(manage_channels=True)
    async def ticket_delete(self, interaction: discord.Interaction):
        ticket_data = database.get_ticket(interaction.channel.id)
        if not ticket_data:
            await interaction.response.send_message("❌ This channel is not a ticket channel.", ephemeral=True)
            return

        if ticket_data['status'] != 'closed':
            await interaction.response.send_message("❌ You can only delete closed ticket channels. Please close the ticket first.", ephemeral=True)
            return

        await interaction.response.send_message("🔥 **Deleting channel in 5 seconds...**")
        await asyncio.sleep(5)
        try:
            await interaction.channel.delete(reason="Ticket channel permanently deleted by staff")
            logger.info(f"Ticket channel deleted: {interaction.channel.name} ({interaction.channel.id}) by {interaction.user.name}")
        except Exception as e:
            logger.error(f"Failed to delete ticket channel: {e}")


    # Add user to ticket
    @app_commands.command(name="ticket_add", description="Add a user to this ticket channel.")
    @app_commands.default_permissions(manage_channels=True)
    @app_commands.describe(member="Member to add")
    async def ticket_add(self, interaction: discord.Interaction, member: discord.Member):
        ticket_data = database.get_ticket(interaction.channel.id)
        if not ticket_data:
            await interaction.response.send_message("❌ This is not an active ticket channel.", ephemeral=True)
            return

        try:
            await interaction.channel.set_permissions(
                member,
                view_channel=True,
                send_messages=True,
                read_message_history=True,
                attach_files=True,
                embed_links=True,
                reason=f"Added to ticket by {interaction.user.name}"
            )
            await interaction.response.send_message(f"✅ Added {member.mention} to the ticket channel.")
            logger.info(f"Added {member.name} to ticket channel {interaction.channel.id} by {interaction.user.name}")
        except Exception as e:
            await interaction.response.send_message(f"❌ Failed to add member: {e}", ephemeral=True)

    # Remove user from ticket
    @app_commands.command(name="ticket_remove", description="Remove a user from this ticket channel.")
    @app_commands.default_permissions(manage_channels=True)
    @app_commands.describe(member="Member to remove")
    async def ticket_remove(self, interaction: discord.Interaction, member: discord.Member):
        ticket_data = database.get_ticket(interaction.channel.id)
        if not ticket_data:
            await interaction.response.send_message("❌ This is not an active ticket channel.", ephemeral=True)
            return

        if member.id == ticket_data['user_id']:
            await interaction.response.send_message("❌ You cannot remove the ticket creator from their own ticket.", ephemeral=True)
            return

        try:
            await interaction.channel.set_permissions(member, overwrite=None, reason=f"Removed from ticket by {interaction.user.name}")
            await interaction.response.send_message(f"✅ Removed {member.mention} from the ticket channel.")
            logger.info(f"Removed {member.name} from ticket channel {interaction.channel.id} by {interaction.user.name}")
        except Exception as e:
            await interaction.response.send_message(f"❌ Failed to remove member: {e}", ephemeral=True)

async def setup(bot):
    await bot.add_cog(Tickets(bot))
