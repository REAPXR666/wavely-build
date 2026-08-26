import discord
from discord import app_commands
from discord.ext import commands
import logging
import os
import time

logger = logging.getLogger('WavelyBot.AntiRaid')

class RaidResolveView(discord.ui.View):
    def __init__(self, bot, guild_id: int):
        super().__init__(timeout=None)
        self.bot = bot
        self.guild_id = guild_id

    @discord.ui.button(
        label="Resolve Raid & Enable Invites", 
        style=discord.ButtonStyle.success, 
        custom_id="wavely_resolve_raid",
        emoji="🛡️"
    )
    async def resolve_callback(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Defer interaction
        await interaction.response.defer()
        
        guild = self.bot.get_guild(self.guild_id)
        if not guild:
            await interaction.followup.send("❌ Error: Guild not found. I might not be in the server anymore.", ephemeral=True)
            return

        # Attempt to disable invite pausing and restore settings
        success_messages = []
        errors = []

        # 1. Re-enable invites via API
        try:
            await guild.edit(invites_disabled=False)
            success_messages.append("✅ Invites re-enabled (invites_disabled = False)")
        except Exception as e:
            errors.append(f"Could not re-enable invites via API: {e}")

        # 2. Restore @everyone invite creation permission
        try:
            everyone = guild.default_role
            permissions = everyone.permissions
            if not permissions.create_instant_invite:
                permissions.update(create_instant_invite=True)
                await everyone.edit(permissions=permissions, reason="Raid resolved - invite permission restored")
                success_messages.append("✅ Restored invite creation permission to @everyone")
        except Exception as e:
            errors.append(f"Could not restore @everyone invite permissions: {e}")

        # 3. Restore Verification Level to Medium
        try:
            await guild.edit(verification_level=discord.VerificationLevel.medium)
            success_messages.append("✅ Restored Verification Level to Medium")
        except Exception as e:
            errors.append(f"Could not restore verification level: {e}")

        # Clear raid mode state in Cog
        antiraid_cog = self.bot.get_cog("AntiRaid")
        if antiraid_cog:
            antiraid_cog.raid_mode_active = False

        status_text = "\n".join(success_messages)
        if errors:
            status_text += "\n\n⚠️ **Errors encountered:**\n" + "\n".join(errors)

        # Update the owner DM message
        embed = interaction.message.embeds[0]
        embed.title = "🛡️ Raid Status: RESOLVED"
        embed.description = f"Raid shield has been disabled. Server settings updated:\n\n{status_text}"
        embed.color = discord.Color.green()
        
        # Disable button
        button.disabled = True
        await interaction.message.edit(embed=embed, view=self)
        await interaction.followup.send("🛡️ Raid has been resolved and settings restored.", ephemeral=True)


class AntiRaid(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        
        # Load environment values
        guild_id_raw = os.getenv("GUILD_ID")
        owner_id_raw = os.getenv("OWNER_ID")
        
        self.target_guild_id = int(guild_id_raw) if guild_id_raw else 1506375091494322276
        self.owner_id = int(owner_id_raw) if owner_id_raw else 1159555371279597770
        
        # Sliding join window: stores lists of tuples (join_time: float, member_name_id: str)
        self.recent_joins = []
        self.raid_threshold = 5     # 5 joins
        self.raid_window = 10.0     # within 10 seconds
        self.raid_mode_active = False

    async def cog_load(self):
        # Register persistent view for DM button
        self.bot.add_view(RaidResolveView(self.bot, self.target_guild_id))
        # Register group slash commands
        self.bot.tree.add_command(AntiRaidGroup(self))
        logger.info("AntiRaid persistent view and commands registered.")

    @commands.Cog.listener()
    async def on_member_join(self, member):
        # Verify the guild matches the target guild
        if member.guild.id != self.target_guild_id:
            return
            
        current_time = time.time()
        member_info = f"{member.name} ({member.id})"
        self.recent_joins.append((current_time, member_info))
        
        # Filter joins outside the sliding window
        self.recent_joins = [
            j for j in self.recent_joins if current_time - j[0] <= self.raid_window
        ]
        
        # If join threshold is exceeded and raid mode is not already active
        if len(self.recent_joins) >= self.raid_threshold and not self.raid_mode_active:
            self.raid_mode_active = True
            await self.trigger_raid_shield(member.guild)

    async def trigger_raid_shield(self, guild):
        logger.warning(f"🚨 Raid detected in guild: {guild.name}! Activating server shield...")
        
        actions_taken = []
        errors = []

        # 1. Attempt to pause invites via API
        try:
            await guild.edit(invites_disabled=True)
            actions_taken.append("✅ Paused server invites (invites_disabled = True)")
        except Exception as e:
            errors.append(f"Failed to pause invites via guild.edit: {e}")

        # 2. Fallback: Revoke Create Invite permission from @everyone role
        try:
            everyone = guild.default_role
            permissions = everyone.permissions
            if permissions.create_instant_invite:
                permissions.update(create_instant_invite=False)
                await everyone.edit(permissions=permissions, reason="Anti-Raid: Revoked invite permission")
                actions_taken.append("✅ Revoked Create Invite permissions from @everyone")
        except Exception as e:
            errors.append(f"Failed to revoke @everyone invite permission: {e}")

        # 3. Fallback: Increase Server Verification Level to Highest
        try:
            await guild.edit(verification_level=discord.VerificationLevel.highest)
            actions_taken.append("✅ Server verification level set to HIGHEST (double table)")
        except Exception as e:
            errors.append(f"Failed to set verification level to Highest: {e}")

        # Gather list of members who triggered the raid
        violators = "\n".join([f"• {j[1]}" for j in self.recent_joins])
        
        # Construct logs report
        actions_log = "\n".join(actions_taken)
        if errors:
            actions_log += "\n\n⚠️ **Failed actions (errors):**\n" + "\n".join(errors)

        # Notify Owner via DM
        owner = self.bot.get_user(self.owner_id)
        if not owner:
            # Try to fetch owner if not in cache
            try:
                owner = await self.bot.fetch_user(self.owner_id)
            except Exception as e:
                logger.error(f"Could not fetch owner ID {self.owner_id}: {e}")

        if owner:
            embed = discord.Embed(
                title="🚨 RAID DETECTED & SHIELD ACTIVATED",
                description=(
                    f"A sudden join activity has triggered the Anti-Raid shield in **{guild.name}**.\n\n"
                    f"**Triggering members (within {self.raid_window} seconds):**\n{violators}\n\n"
                    f"**Shield Status:**\n{actions_log}\n\n"
                    "Click the button below to resolve the raid and restore original server settings once safe."
                ),
                color=discord.Color.red()
            )
            embed.set_footer(text="Wavely Anti-Raid System")
            
            view = RaidResolveView(self.bot, guild.id)
            try:
                await owner.send(embed=embed, view=view)
                logger.info("Sent Anti-Raid DM alert to owner.")
            except discord.Forbidden:
                logger.error("Could not DM owner. Owner has DMs blocked.")
        else:
            logger.error(f"Owner object (ID: {self.owner_id}) could not be resolved to send alert DM.")


@app_commands.default_permissions(manage_guild=True)
@app_commands.guild_only()
class AntiRaidGroup(app_commands.Group):
    def __init__(self, cog):
        super().__init__(name="antiraid", description="Anti-Raid administration commands.")
        self.cog = cog

    @app_commands.command(name="status", description="Check current raid shield status.")
    async def antiraid_status(self, interaction: discord.Interaction):
        guild = interaction.guild
        invites_status = "Disabled" if "INVITES_DISABLED" in guild.features or getattr(guild, 'invites_disabled', False) else "Enabled"
        everyone_invite = "Allowed" if guild.default_role.permissions.create_instant_invite else "Blocked"
        
        embed = discord.Embed(
            title="🛡️ Raid Shield Diagnostics",
            description=(
                f"**Raid Shield Active:** {'🔴 YES (Shield On)' if self.cog.raid_mode_active else '🟢 NO (Shield Off)'}\n"
                f"**Invites Status:** {invites_status}\n"
                f"**Verification Level:** {guild.verification_level.name}\n"
                f"**@everyone Invite Creation:** {everyone_invite}\n\n"
                f"**Join Rate Limits:** {self.cog.raid_threshold} joins per {self.cog.raid_window}s"
            ),
            color=discord.Color.blue()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="toggle", description="Manually activate or deactivate the Anti-Raid server shield.")
    @app_commands.describe(shield_active="Set True to lock the server, False to release")
    async def antiraid_toggle(self, interaction: discord.Interaction, shield_active: bool):
        guild = interaction.guild
        await interaction.response.defer(ephemeral=True)
        
        if shield_active:
            self.cog.raid_mode_active = True
            await self.cog.trigger_raid_shield(guild)
            await interaction.followup.send("🚨 **Manual Raid Shield ACTIVATED!** Server locked down and owner DM'd.", ephemeral=True)
        else:
            self.cog.raid_mode_active = False
            
            # Reset settings
            success = []
            try:
                await guild.edit(invites_disabled=False)
                success.append("Re-enabled invites")
            except: pass
            
            try:
                everyone = guild.default_role
                permissions = everyone.permissions
                permissions.update(create_instant_invite=True)
                await everyone.edit(permissions=permissions)
                success.append("Restored @everyone invite permission")
            except: pass
            
            try:
                await guild.edit(verification_level=discord.VerificationLevel.medium)
                success.append("Restored verification level to Medium")
            except: pass
            
            actions = ", ".join(success)
            await interaction.followup.send(f"🛡️ **Raid Shield DEACTIVATED.** Settings restored: {actions}.", ephemeral=True)
            logger.info(f"Manual raid shield disabled by {interaction.user.name}")


async def setup(bot):
    await bot.add_cog(AntiRaid(bot))
