import discord
from discord import app_commands
from discord.ext import commands
import logging
from datetime import timedelta
import time
import database

logger = logging.getLogger('WavelyBot.Moderation')

class Moderation(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # 1. KICK
    @app_commands.command(name="kick", description="Kick a member from the server.")
    @app_commands.default_permissions(kick_members=True)
    @app_commands.describe(member="Member to kick", reason="Reason for kicking")
    async def kick(self, interaction: discord.Interaction, member: discord.Member, reason: str = "No reason provided"):
        # Check hierarchy
        if interaction.user.top_role <= member.top_role and interaction.user.id != interaction.guild.owner_id:
            await interaction.response.send_message("❌ You cannot kick a member with an equal or higher role than yourself.", ephemeral=True)
            return

        if interaction.guild.me.top_role <= member.top_role:
            await interaction.response.send_message("❌ I cannot kick this member. Their role is higher than my highest role.", ephemeral=True)
            return

        try:
            # DM user first
            try:
                embed = discord.Embed(
                    title=f"Kicked from {interaction.guild.name}",
                    description=f"You have been kicked from the server.\n**Reason:** {reason}",
                    color=discord.Color.orange()
                )
                await member.send(embed=embed)
            except discord.Forbidden:
                pass # Member has DMs disabled

            await member.kick(reason=f"[Mod: {interaction.user.name}] {reason}")
            await interaction.response.send_message(f"✅ **{member.display_name}** has been successfully kicked.\nReason: {reason}", ephemeral=False)
            logger.info(f"Mod {interaction.user.name} kicked member {member.name} ({member.id}) for: {reason}")
        except Exception as e:
            await interaction.response.send_message(f"❌ Failed to kick member: {e}", ephemeral=True)

    # 2. BAN
    @app_commands.command(name="ban", description="Ban a member from the server.")
    @app_commands.default_permissions(ban_members=True)
    @app_commands.describe(member="Member to ban", reason="Reason for banning", delete_messages="Days of messages to delete (0-7)")
    async def ban(self, interaction: discord.Interaction, member: discord.Member, reason: str = "No reason provided", delete_messages: int = 0):
        # Check hierarchy
        if interaction.user.top_role <= member.top_role and interaction.user.id != interaction.guild.owner_id:
            await interaction.response.send_message("❌ You cannot ban a member with an equal or higher role than yourself.", ephemeral=True)
            return

        if interaction.guild.me.top_role <= member.top_role:
            await interaction.response.send_message("❌ I cannot ban this member. Their role is higher than my highest role.", ephemeral=True)
            return

        # Ensure delete messages count is valid
        delete_seconds = min(7, max(0, delete_messages)) * 86400

        try:
            # DM user first
            try:
                embed = discord.Embed(
                    title=f"Banned from {interaction.guild.name}",
                    description=f"You have been banned from the server.\n**Reason:** {reason}",
                    color=discord.Color.red()
                )
                await member.send(embed=embed)
            except discord.Forbidden:
                pass # Member has DMs disabled

            await member.ban(
                delete_message_seconds=delete_seconds,
                reason=f"[Mod: {interaction.user.name}] {reason}"
            )
            await interaction.response.send_message(f"✅ **{member.display_name}** has been banned permanently.\nReason: {reason}", ephemeral=False)
            logger.info(f"Mod {interaction.user.name} banned {member.name} ({member.id}) for: {reason}")
        except Exception as e:
            await interaction.response.send_message(f"❌ Failed to ban member: {e}", ephemeral=True)

    # 3. UNBAN
    @app_commands.command(name="unban", description="Unban a user from the server using their User ID.")
    @app_commands.default_permissions(ban_members=True)
    @app_commands.describe(user_id="The Discord User ID to unban", reason="Reason for unbanning")
    async def unban(self, interaction: discord.Interaction, user_id: str, reason: str = "No reason provided"):
        try:
            user_id_int = int(user_id)
        except ValueError:
            await interaction.response.send_message("❌ Invalid User ID. Must be numerical.", ephemeral=True)
            return

        # Fetch ban entry to confirm they are banned
        try:
            user = await self.bot.fetch_user(user_id_int)
            await interaction.guild.unban(user, reason=f"[Mod: {interaction.user.name}] {reason}")
            await interaction.response.send_message(f"✅ **{user.name}** ({user_id}) has been unbanned.\nReason: {reason}")
            logger.info(f"Mod {interaction.user.name} unbanned {user.name} ({user_id})")
        except discord.NotFound:
            await interaction.response.send_message("❌ User is not banned or could not be found.", ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"❌ Failed to unban user: {e}", ephemeral=True)

    # 4. TIMEOUT
    @app_commands.command(name="timeout", description="Place a member in timeout (mute them).")
    @app_commands.default_permissions(moderate_members=True)
    @app_commands.describe(member="Member to timeout", minutes="Timeout duration in minutes", reason="Reason for timeout")
    async def timeout(self, interaction: discord.Interaction, member: discord.Member, minutes: int, reason: str = "No reason provided"):
        # Check hierarchy
        if interaction.user.top_role <= member.top_role and interaction.user.id != interaction.guild.owner_id:
            await interaction.response.send_message("❌ You cannot timeout a member with an equal or higher role than yourself.", ephemeral=True)
            return

        if interaction.guild.me.top_role <= member.top_role:
            await interaction.response.send_message("❌ I cannot timeout this member. Their role is higher than my highest role.", ephemeral=True)
            return

        if minutes <= 0:
            await interaction.response.send_message("❌ Timeout duration must be greater than zero.", ephemeral=True)
            return

        duration = timedelta(minutes=minutes)

        try:
            await member.timeout(duration, reason=f"[Mod: {interaction.user.name}] {reason}")
            
            # DM user
            try:
                embed = discord.Embed(
                    title=f"Timed out in {interaction.guild.name}",
                    description=f"You have been placed in timeout for {minutes} minutes.\n**Reason:** {reason}",
                    color=discord.Color.red()
                )
                await member.send(embed=embed)
            except discord.Forbidden:
                pass

            await interaction.response.send_message(f"✅ **{member.display_name}** has been timed out for **{minutes}** minutes.\nReason: {reason}")
            logger.info(f"Mod {interaction.user.name} timed out {member.name} for {minutes}m. Reason: {reason}")
        except Exception as e:
            await interaction.response.send_message(f"❌ Failed to timeout member: {e}", ephemeral=True)

    # 5. WARN
    @app_commands.command(name="warn", description="Issue a warning to a member.")
    @app_commands.default_permissions(moderate_members=True)
    @app_commands.describe(member="Member to warn", reason="Reason for warning")
    async def warn(self, interaction: discord.Interaction, member: discord.Member, reason: str):
        # Check hierarchy
        if interaction.user.top_role <= member.top_role and interaction.user.id != interaction.guild.owner_id:
            await interaction.response.send_message("❌ You cannot warn a member with an equal or higher role than yourself.", ephemeral=True)
            return

        # Add to database
        warnings_count = database.add_warning(
            user_id=member.id,
            guild_id=interaction.guild.id,
            moderator_id=interaction.user.id,
            reason=reason
        )

        # DM User
        try:
            embed = discord.Embed(
                title=f"⚠️ Warning from {interaction.guild.name}",
                description=f"You have been warned by a moderator.\n**Reason:** {reason}\n*This is warning #{warnings_count}.*",
                color=discord.Color.yellow()
            )
            await member.send(embed=embed)
        except discord.Forbidden:
            pass

        await interaction.response.send_message(
            f"⚠️ **{member.display_name}** has been warned.\n**Reason:** {reason}\n*Active warnings: {warnings_count}*"
        )
        logger.info(f"Mod {interaction.user.name} warned {member.name} ({member.id}) for: {reason}")

    # 6. WARNINGS HISTORY
    @app_commands.command(name="warnings", description="View warnings history for a member.")
    @app_commands.default_permissions(moderate_members=True)
    @app_commands.describe(member="Member to lookup")
    async def warnings(self, interaction: discord.Interaction, member: discord.Member):
        warnings_list = database.get_warnings(member.id, interaction.guild.id)
        
        if not warnings_list:
            await interaction.response.send_message(f"🟢 **{member.display_name}** has 0 active warnings.")
            return

        embed = discord.Embed(
            title=f"⚠️ Warning Logs - {member.display_name}",
            description=f"Total active warnings: **{len(warnings_list)}**",
            color=discord.Color.yellow()
        )
        if member.avatar:
            embed.set_thumbnail(url=member.avatar.url)

        for index, warn in enumerate(warnings_list):
            mod = interaction.guild.get_member(warn['moderator_id'])
            mod_name = mod.display_name if mod else f"Mod ID: {warn['moderator_id']}"
            warn_date = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(warn['timestamp']))
            
            embed.add_field(
                name=f"Warning #{len(warnings_list) - index} ({warn_date})",
                value=f"**Reason:** {warn['reason']}\n**Issued by:** {mod_name}",
                inline=False
            )

        await interaction.response.send_message(embed=embed)

    # 7. CLEAR WARNINGS
    @app_commands.command(name="clearwarnings", description="Clear all warnings for a member.")
    @app_commands.default_permissions(moderate_members=True)
    @app_commands.describe(member="Member to clear warnings for")
    async def clearwarnings(self, interaction: discord.Interaction, member: discord.Member):
        deleted_count = database.clear_warnings(member.id, interaction.guild.id)
        
        if deleted_count == 0:
            await interaction.response.send_message(f"🟢 **{member.display_name}** had no active warnings to clear.", ephemeral=True)
            return

        await interaction.response.send_message(f"✅ Cleared **{deleted_count}** warning(s) for **{member.display_name}**.")
        logger.info(f"Mod {interaction.user.name} cleared all warnings ({deleted_count}) for {member.name}")

    # 8. PURGE
    @app_commands.command(name="purge", description="Purge messages in this channel.")
    @app_commands.default_permissions(manage_messages=True)
    @app_commands.describe(amount="Amount of messages to delete")
    async def purge(self, interaction: discord.Interaction, amount: int):
        if amount <= 0:
            await interaction.response.send_message("❌ Amount must be greater than zero.", ephemeral=True)
            return

        # Defer so we don't timeout
        await interaction.response.defer(ephemeral=True)
        
        # Max purge limit 100 per call for safety
        limit = min(100, amount)

        try:
            deleted = await interaction.channel.purge(limit=limit)
            await interaction.followup.send(f"✅ Successfully deleted **{len(deleted)}** messages.", ephemeral=True)
            logger.info(f"Mod {interaction.user.name} purged {len(deleted)} messages in channel {interaction.channel.id}")
        except discord.Forbidden:
            await interaction.followup.send("❌ Error: I do not have Manage Messages permissions in this channel.", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ An error occurred: {e}", ephemeral=True)

async def setup(bot):
    await bot.add_cog(Moderation(bot))
