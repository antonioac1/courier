from setuptools import setup, find_packages

setup(
    name="courier-agent-email",
    version="0.1.0",
    description="Temporary email inboxes for AI agents. Receive OTP codes, magic links, and verification emails. No signup. Zero dependencies.",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Courier",
    author_email="antonio@jagspartners.com",
    url="https://github.com/antonioac1/courier",
    py_modules=["courier_agent"],
    python_requires=">=3.7",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Topic :: Communications :: Email",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
    ],
    keywords="temporary email, ai agent, otp, verification code, magic link, disposable inbox, autonomous email, email verification, agent authentication, receive email",
)
