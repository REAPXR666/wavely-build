import discord
from discord.ext import commands
import logging
import os

logger = logging.getLogger('WavelyBot.Welcome')

class Welcome(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        # Load target guild ID from env to ensure we welcome members of the correct guild
        guild_id_raw = os.getenv("GUILD_ID")
        self.target_guild_id = int(guild_id_raw) if guild_id_raw else None

    @commands.Cog.listener()
    async def on_member_join(self, member):
        # Ignore bots
        if member.bot:
            return
            
        # Verify the guild matches if configured
        if self.target_guild_id and member.guild.id != self.target_guild_id:
            return

        logger.info(f"Member joined: {member.name} (ID: {member.id}) in guild: {member.guild.name}")
        
        # Create welcome embed with a premium dark purple theme
        embed = discord.Embed(
            title="Thank you for joining Wavely",
            description=(
                "We are thrilled to have you as part of our community!\n\n"
                "**⚠️ Server Policy Alert:**\n"
                "Please do not expose this server to the public or you will breach our Terms of Service (TOs), "
                "which will lead to an immediate ban.\n\n"
                "To support our work and keep the project alive, feel free to support us below!"
            ),
            color=discord.Color.from_str("#7a22ff") # Premium vibrant purple
        )
        
        # Embed fields
        embed.add_field(
            name="☕ Support Wavely",
            value="[Buy Me A Coffee](https://buymeacoffee.com/wavely)",
            inline=False
        )
        embed.set_footer(text="Wavely Official Security • Safe and Secure", icon_url=member.guild.icon.url if member.guild.icon else None)
        
        # Create a view with a direct URL button for Buy Me A Coffee
        view = discord.ui.View()
        view.add_item(discord.ui.Button(
            label="Support on BuyMeACoffee",
            style=discord.ButtonStyle.link,
            url="https://buymeacoffee.com/wavely",
            emoji="☕"
        ))
        
        try:
            await member.send(embed=embed, view=view)
            logger.info(f"Successfully sent welcome DM to {member.name}")
        except discord.Forbidden:
            logger.warning(f"Could not send welcome DM to {member.name} (DMs are closed/blocked)")
        except Exception as e:
            logger.error(f"Error sending welcome DM to {member.name}: {e}")

async def setup(bot):
    await bot.add_cog(Welcome(bot))
