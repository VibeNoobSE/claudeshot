registerGame("zombie", "🧟 Zombie Survival", "WASD+SPACE to move & shoot", "Survive waves — highest score wins!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a1a0a");
    this.player=this.add.circle(W/2,H/2,12,0x4ecca3);this.physics.add.existing(this.player);this.player.body.setCollideWorldBounds(true);
    this.zombies=this.physics.add.group();this.bullets=this.physics.add.group();
    this.score=0;this.hp=5;this.wave=1;
    this.sTxt=this.add.text(16,16,"Score: 0 | HP: 5 | Wave: 1",{fontSize:"16px",color:"#4ecca3",fontFamily:"monospace"});
    this.physics.add.overlap(this.bullets,this.zombies,(b,z)=>{b.destroy();z.destroy();this.score+=10;this.sTxt.setText("Score: "+this.score+" | HP: "+this.hp+" | Wave: "+this.wave);});
    this.physics.add.overlap(this.player,this.zombies,(p,z)=>{z.destroy();this.hp--;this.sTxt.setText("Score: "+this.score+" | HP: "+this.hp+" | Wave: "+this.wave);
      if(this.hp<=0){this.physics.pause();this.add.text(W/2,H/2,"GAME OVER\nScore: "+this.score,{fontSize:"32px",color:"#e94560",fontFamily:"monospace",align:"center"}).setOrigin(0.5);}});
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",space:"SPACE",up:"UP",left:"LEFT",right:"RIGHT",down:"DOWN"});
    this.lastShot=0;this.aimAngle=0;
    this.spawnWave();
  }
  spawnWave(){for(let i=0;i<this.wave*3+2;i++){
    const edge=Phaser.Math.Between(0,3);let x,y;
    if(edge===0){x=Phaser.Math.Between(0,W);y=-20;}else if(edge===1){x=W+20;y=Phaser.Math.Between(0,H);}
    else if(edge===2){x=Phaser.Math.Between(0,W);y=H+20;}else{x=-20;y=Phaser.Math.Between(0,H);}
    const z=this.add.circle(x,y,10,0x884422);this.zombies.add(z);this.physics.add.existing(z);
  }}
  update(t){const s=220,k=this.k;
    this.player.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    // Aim with arrow keys
    if(k.left.isDown)this.aimAngle=Math.PI;if(k.right.isDown)this.aimAngle=0;
    if(k.up.isDown)this.aimAngle=-Math.PI/2;if(k.down.isDown)this.aimAngle=Math.PI/2;
    if(k.space.isDown&&t>this.lastShot+200){this.lastShot=t;
      const b=this.add.circle(this.player.x,this.player.y,4,0x4ecca3);this.bullets.add(b);this.physics.add.existing(b);
      b.body.setVelocity(Math.cos(this.aimAngle)*400,Math.sin(this.aimAngle)*400);this.time.delayedCall(1500,()=>b.destroy());}
    // Zombies chase player
    this.zombies.getChildren().forEach(z=>{if(!z.active)return;const a=Phaser.Math.Angle.Between(z.x,z.y,this.player.x,this.player.y);z.body.setVelocity(Math.cos(a)*60,Math.sin(a)*60);});
    if(this.zombies.countActive()===0&&this.hp>0){this.wave++;this.sTxt.setText("Score: "+this.score+" | HP: "+this.hp+" | Wave: "+this.wave);this.spawnWave();}
  }
});
