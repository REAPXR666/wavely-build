import discord
from discord import app_commands
from discord.ext import commands
import logging
import os

logger = logging.getLogger('WavelyBot.Verification')

class VerificationButton(discord.ui.Button):
    def __init__(self, role_id: int):
        super().__init__(
            label="Click me to get download",
            style=discord.ButtonStyle.success,
            custom_id="wavely_verify_button",
            emoji="📥"
        )
        self.role_id = role_id

    async def callback(self, interaction: discord.Interaction):
        # Fetch the role to assign
        role = interaction.guild.get_role(self.role_id)
        if not role:
            await interaction.response.send_message(
                "❌ Error: Verification role not found on this server. Please contact an administrator.",
                ephemeral=True
            )
            return

        # Check if user already has the role
        if role in interaction.user.roles:
            await interaction.response.send_message(
                "ℹ️ You already have verification access!",
                ephemeral=True
            )
            return

        try:
            # Assign role to user
            await interaction.user.add_roles(role, reason="Verification button clicked")
            await interaction.response.send_message(
                f"✅ **Verification Successful!**\n"
                f"You have been given the **{role.name}** role. You can now access the downloads and commands!",
                ephemeral=True
            )
            logger.info(f"Granted verified role {self.role_id} to {interaction.user.name} ({interaction.user.id})")
        except discord.Forbidden:
            await interaction.response.send_message(
                "❌ Error: I do not have permission to manage roles. Please verify that my bot role is higher than the verified role in Server Settings.",
                ephemeral=True
            )
            logger.error(f"Failed to add role {self.role_id} to {interaction.user.name} due to permissions.")
        except Exception as e:
            await interaction.response.send_message(
                "❌ An unexpected error occurred during verification. Please try again later.",
                ephemeral=True
            )
            logger.error(f"Error in verification button callback: {e}", exc_info=True)


class VerificationView(discord.ui.View):
    def __init__(self, role_id: int):
        super().__init__(timeout=None) # Timeout=None makes it persistent
        self.add_item(VerificationButton(role_id))


class Verification(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        
        # Load verification settings
        role_id_raw = os.getenv("VERIFY_ROLE_ID")
        channel_id_raw = os.getenv("VERIFY_CHANNEL_ID")
        
        self.verify_role_id = int(role_id_raw) if role_id_raw else 1506425502313877554
        self.verify_channel_id = int(channel_id_raw) if channel_id_raw else 1506426058319204372

    async def cog_load(self):
        # Register the persistent view with the bot when the cog is loaded
        self.bot.add_view(VerificationView(role_id=self.verify_role_id))
        logger.info("Verification persistent view registered.")

    @app_commands.command(name="verify_setup", description="Deploy the verification banner with the download role button.")
    @app_commands.default_permissions(administrator=True)
    async def verify_setup(self, interaction: discord.Interaction):
        # Fetch the channel configured
        target_channel = interaction.guild.get_channel(self.verify_channel_id)
        
        if not target_channel:
            # Fallback to current channel if configured channel isn't found
            target_channel = interaction.channel
            await interaction.response.send_message(
                f"⚠️ Configured channel ID `{self.verify_channel_id}` was not found. Deploying here instead.",
                ephemeral=True
            )
        else:
            await interaction.response.send_message(
                f"✅ Verification banner is being sent to {target_channel.mention}...",
                ephemeral=True
            )
            
        role = interaction.guild.get_role(self.verify_role_id)
        role_mention = role.mention if role else "Verified Role"

        # Create a beautiful verification embed
        embed = discord.Embed(
            title="📥 Wavely Access Verification",
            description=(
                "Welcome to the **Wavely** server download & verification portal!\n\n"
                "By clicking the button below, you will confirm your membership and be granted "
                f"the {role_mention} role, which gives you full access to the downloads and ticket systems.\n\n"
                "**Terms of Service Reminder:**\n"
                "• Do NOT leak or share download links outside of this server.\n"
                "• Keep the server invite private unless authorized by moderators.\n"
                "• Violation of these terms will result in an permanent ban and revocation of access."
            ),
            color=discord.Color.from_str("#00fa9a") # Neon Mint green for download vibes
        )
        embed.set_footer(text="Wavely Downloader Gatekeeper System")
        if interaction.guild.icon:
            embed.set_thumbnail(url=interaction.guild.icon.url)
            
        view = VerificationView(self.verify_role_id)
        await target_channel.send(embed=embed, view=view)
        logger.info(f"Verification setup deployed in channel {target_channel.id} by {interaction.user.name}")

async def setup(bot):
    await bot.add_cog(Verification(bot))
