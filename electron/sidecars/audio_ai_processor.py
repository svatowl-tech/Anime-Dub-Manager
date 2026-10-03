#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audio AI Neural Processor (Sidecar CLI) for Anime Dub Manager.
Mirror location for sidecars directory.
"""
import os
import sys

# Import from services/audio_ai_processor.py
current_dir = os.path.dirname(os.path.abspath(__file__))
services_dir = os.path.join(os.path.dirname(current_dir), 'services')
if services_dir not in sys.path:
    sys.path.insert(0, services_dir)

import audio_ai_processor

if __name__ == "__main__":
    audio_ai_processor.main()
